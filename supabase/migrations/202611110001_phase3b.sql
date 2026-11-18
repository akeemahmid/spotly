begin;
-- Operation-aware Storage policies are required to deny signed bearer URLs,
-- resumable/copy paths, and upload tokens which outlive a reservation.
do $$ begin
 if to_regprocedure('storage.allow_only_operation(text)') is null then
  raise exception 'Storage operation-aware policy support is required; update the disposable Storage stack and review hosted support before applying';
 end if;
end $$;
-- Deployment does not enable field work. Database owner opens this gate only after
-- matching signing diagnostics and dedicated-account authorization checks pass.
create table spotly_private.workflow_gate (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false, live_checks_verified boolean not null default false
);
insert into spotly_private.workflow_gate(singleton) values(true);
alter table spotly_private.workflow_gate enable row level security;
revoke all on spotly_private.workflow_gate from public,anon,authenticated;
create table public.task_assignments (
 id uuid primary key default gen_random_uuid(),
 verification_request_id text not null unique references public.verification_requests(id),
 plan_id uuid not null references public.verification_plans(id),
 verifier_id uuid not null references auth.users(id), assigned_by uuid not null references auth.users(id),
 status text not null default 'offered' check(status in ('offered','accepted','declined','submitted','revision_requested','approved','completed')),
 submission_round integer not null default 1 check(submission_round between 1 and 10),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.task_assignments(verifier_id,created_at);
create table public.task_evidence (
 id uuid primary key, assignment_id uuid not null references public.task_assignments(id),
 verifier_id uuid not null references auth.users(id), submission_round integer not null,
 file_path text not null unique, mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 byte_size integer not null check(byte_size between 1 and 8388608),
 sha256 text check(sha256 ~ '^[0-9a-f]{64}$'), observation text not null check(length(observation) between 1 and 4000),
 location jsonb check(location is null or coalesce((jsonb_typeof(location)='object' and location->'consent'='true'::jsonb
  and jsonb_typeof(location->'latitude')='number' and jsonb_typeof(location->'longitude')='number'
  and (location->>'latitude')::numeric between -90 and 90 and (location->>'longitude')::numeric between -180 and 180
  and location-array['consent','latitude','longitude']='{}'::jsonb),false)),
 submitted_at timestamptz, created_at timestamptz not null default now(),
 unique(assignment_id,submission_round)
);
create table public.assignment_events (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.task_assignments(id),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('assigned','accept','decline','submitted','approve','revise','complete')),
 evidence_id uuid references public.task_evidence(id), note text not null default '' check(length(note)<=2000),
 created_at timestamptz not null default now()
);
create index on public.assignment_events(assignment_id,created_at);
alter table public.task_assignments enable row level security;
alter table public.task_evidence enable row level security;
alter table public.assignment_events enable row level security;
revoke all on public.task_assignments,public.task_evidence,public.assignment_events from public,anon,authenticated;
grant select on public.task_assignments,public.task_evidence,public.assignment_events to authenticated;

create function public.phase3b_ready() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and live_checks_verified from spotly_private.workflow_gate where singleton),false)
 and exists(select 1 from spotly_private.serv_plan_key where singleton)
$$;
create function public.is_assigned_verifier(request_id text, selected_plan uuid default null) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.task_assignments a join public.verification_requests r on r.id=a.verification_request_id
 join public.workspace_members m on m.workspace_id=r.workspace_id and m.user_id=auth.uid() and m.role='verifier'
 where a.verification_request_id=request_id and a.verifier_id=auth.uid() and (selected_plan is null or a.plan_id=selected_plan))
$$;
create function public.can_read_assignment(assignment uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.task_assignments a join public.verification_requests r on r.id=a.verification_request_id
 where a.id=assignment and (public.is_workspace_member(r.workspace_id,true) or public.is_assigned_verifier(r.id)))
$$;
-- Verifier membership alone must never reveal the workspace's other requests/plans.
drop policy request_read on public.verification_requests;
drop policy plan_read on public.verification_plans;
drop policy event_read on public.task_events;
drop policy member_read on public.workspace_members;
create policy member_read on public.workspace_members for select to authenticated using(user_id=auth.uid() or public.is_workspace_member(workspace_id,true));
create policy request_read on public.verification_requests for select to authenticated using(public.is_workspace_member(workspace_id,true) or public.is_assigned_verifier(id));
create policy plan_read on public.verification_plans for select to authenticated using(
 exists(select 1 from public.verification_requests r where r.id=verification_request_id and public.is_workspace_member(r.workspace_id,true))
 or public.is_assigned_verifier(verification_request_id,id));
create policy event_read on public.task_events for select to authenticated using(
 exists(select 1 from public.verification_requests r where r.id=verification_request_id and public.is_workspace_member(r.workspace_id,true)));
create policy assignment_read on public.task_assignments for select to authenticated using(public.can_read_assignment(id));
create policy evidence_read on public.task_evidence for select to authenticated using(public.can_read_assignment(assignment_id));
create policy assignment_event_read on public.assignment_events for select to authenticated using(public.can_read_assignment(assignment_id));

-- All writes lock the request before the assignment, serializing state changes.
-- Every field/review mutation rechecks the stored accepted plan; imported plans fail.
create function spotly_private.assert_current_request(request_id text, selected_plan uuid) returns void
language plpgsql set search_path='' as $$
declare r public.verification_requests; p public.verification_plans;
begin
 if not public.phase3b_ready() then raise exception 'Workflow gate closed'; end if;
 select * into r from public.verification_requests where id=request_id for update;
 select * into p from public.verification_plans where id=selected_plan and verification_request_id=r.id;
 if r.id is null or r.expiration<=now() or p.id is null or p.accepted_at is null or p.provenance<>'serv_server_v1'
 or p.generated_by is distinct from r.created_by or p.version<>1 or p.request_fingerprint is distinct from r.request_fingerprint
 then raise exception 'Trusted accepted current unexpired plan required'; end if;
end $$;
revoke all on function spotly_private.assert_current_request(text,uuid) from public,anon,authenticated;
create function public.assign_verification(request_id text, selected_plan uuid, verifier uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.verification_requests; a public.task_assignments; result uuid; u uuid:=auth.uid();
begin
 select * into r from public.verification_requests where id=request_id for update;
 if u is null or not public.is_workspace_member(r.workspace_id,true) then raise exception 'Dispatcher required'; end if;
 perform spotly_private.assert_current_request(r.id,selected_plan);
 if verifier=u or not exists(select 1 from public.workspace_members where workspace_id=r.workspace_id and user_id=verifier and role='verifier') then raise exception 'Approved workspace verifier required'; end if;
 if 'video'=any(r.evidence_requirements) then raise exception 'Video evidence is not supported in this phase'; end if;
 select * into a from public.task_assignments where verification_request_id=r.id;
 if a.id is not null then
  if a.verifier_id=verifier and a.plan_id=selected_plan then return a.id; end if;
  raise exception 'Request already assigned';
 end if;
 insert into public.task_assignments(verification_request_id,plan_id,verifier_id,assigned_by) values(r.id,selected_plan,verifier,u) returning id into result;
 insert into public.assignment_events(assignment_id,actor_id,action) values(result,u,'assigned');
 return result;
end $$;
create function public.transition_assignment(assignment uuid, operation text, selected_evidence uuid default null, review_note text default '') returns void
language plpgsql security definer set search_path='' as $$
declare a public.task_assignments; r public.verification_requests; e public.task_evidence; target text; u uuid:=auth.uid();
begin
 select * into a from public.task_assignments where id=assignment;
 select * into r from public.verification_requests where id=a.verification_request_id for update;
 select * into a from public.task_assignments where id=assignment for update;
 if u is null or a.id is null then raise exception 'Assignment unavailable'; end if;
 perform spotly_private.assert_current_request(r.id,a.plan_id);
 if operation in ('accept','decline') then
  if a.verifier_id<>u or not public.is_assigned_verifier(r.id,a.plan_id) then raise exception 'Assigned verifier required'; end if;
  target:=case operation when 'accept' then 'accepted' else 'declined' end;
  if a.status=target then return; end if;
  if a.status<>'offered' then raise exception 'Invalid assignment transition'; end if;
 elsif operation in ('approve','revise','complete') then
  if not public.is_workspace_member(r.workspace_id,true) then raise exception 'Dispatcher required'; end if;
  if review_note is null or length(review_note)>2000 or (operation='revise' and length(trim(review_note))=0) then raise exception 'Invalid review note'; end if;
  select * into e from public.task_evidence where id=selected_evidence and assignment_id=a.id and submitted_at is not null;
  if e.id is null then raise exception 'Submitted evidence required'; end if;
  -- Exact retry succeeds without inserting a second history event, even after round advances.
  if exists(select 1 from public.assignment_events where assignment_id=a.id and action=operation and evidence_id=e.id) then return; end if;
  if e.submission_round<>a.submission_round then raise exception 'Stale evidence'; end if;
  if operation='complete' then
   if a.status<>'approved' then raise exception 'Review approval required'; end if;
   target:='completed';
  else
   if a.status<>'submitted' then raise exception 'Submission awaiting review required'; end if;
   target:=case operation when 'approve' then 'approved' else 'revision_requested' end;
   if operation='revise' and a.submission_round>=10 then raise exception 'Revision limit reached'; end if;
  end if;
 else raise exception 'Unknown operation';
 end if;
 update public.task_assignments set status=target,submission_round=submission_round+case when operation='revise' then 1 else 0 end,updated_at=now() where id=a.id;
 insert into public.assignment_events(assignment_id,actor_id,action,evidence_id,note) values(a.id,u,operation,case when operation in ('approve','revise','complete') then e.id end,coalesce(review_note,''));
end $$;

create function public.reserve_task_evidence(evidence uuid, assignment uuid, observation_text text, mime text, size_bytes integer, consent_location jsonb default null) returns text
language plpgsql security definer set search_path='' as $$
declare a public.task_assignments; r public.verification_requests; e public.task_evidence; path text; u uuid:=auth.uid();
begin
 select * into a from public.task_assignments where id=assignment;
 select * into r from public.verification_requests where id=a.verification_request_id for update;
 select * into a from public.task_assignments where id=assignment for update;
 if u is null or a.verifier_id is distinct from u or not public.is_assigned_verifier(r.id,a.plan_id) then raise exception 'Assigned verifier required'; end if;
 perform spotly_private.assert_current_request(r.id,a.plan_id);
 select * into e from public.task_evidence where id=evidence;
 if e.id is not null then
  if e.assignment_id=a.id and e.verifier_id=u and e.observation=observation_text and e.mime_type=mime and e.byte_size=size_bytes and e.location is not distinct from consent_location then return e.file_path; end if;
  raise exception 'Idempotency conflict';
 end if;
 if a.status not in ('accepted','revision_requested') then raise exception 'Accept assignment before submitting'; end if;
 path:=a.id::text || '/' || evidence::text;
 insert into public.task_evidence(id,assignment_id,verifier_id,submission_round,file_path,mime_type,byte_size,observation,location)
 values(evidence,a.id,u,a.submission_round,path,mime,size_bytes,observation_text,consent_location);
 return path;
end $$;

create function public.submit_task_evidence(payload text, signature text) returns void
language plpgsql security definer set search_path='' as $$
declare v jsonb; e public.task_evidence; a public.task_assignments; r public.verification_requests; secret text; expected bytea; supplied bytea; difference integer:=0; i integer; u uuid:=auth.uid();
begin
 if u is null or payload is null or octet_length(payload)>24000 or signature is null or signature !~ '^[0-9a-f]{64}$' then raise exception 'Invalid evidence receipt'; end if;
 select key_hex into secret from spotly_private.serv_plan_key where singleton;
 if secret is null then raise exception 'Signing unavailable'; end if;
 expected:=extensions.hmac(convert_to(payload,'UTF8'),decode(secret,'hex'),'sha256'); supplied:=decode(signature,'hex');
 for i in 0..31 loop difference:=difference | (get_byte(expected,i) # get_byte(supplied,i)); end loop;
 if difference<>0 then raise exception 'Invalid evidence receipt'; end if;
 v:=payload::jsonb;
 if v->>'purpose' is distinct from 'spotly.evidence.v1' or v->>'userId' is distinct from u::text
 or (v->>'issuedAt')::timestamptz is null or (v->>'issuedAt')::timestamptz<now()-interval '5 minutes' or (v->>'issuedAt')::timestamptz>now()+interval '30 seconds' then raise exception 'Stale evidence receipt'; end if;
 select * into a from public.task_assignments where id=(v->>'assignmentId')::uuid;
 select * into r from public.verification_requests where id=a.verification_request_id for update;
 select * into a from public.task_assignments where id=(v->>'assignmentId')::uuid for update;
 select * into e from public.task_evidence where id=(v->>'id')::uuid for update;
 if a.verifier_id is distinct from u or not public.is_assigned_verifier(r.id,a.plan_id) or e.assignment_id is distinct from a.id or e.verifier_id is distinct from u then raise exception 'Assigned verifier required'; end if;
 perform spotly_private.assert_current_request(r.id,a.plan_id);
 if e.file_path is distinct from v->>'path' or e.observation is distinct from v->>'observation' or e.mime_type is distinct from v->>'mime'
 or e.byte_size is distinct from (v->>'size')::integer or e.location is distinct from nullif(v->'location','null'::jsonb)
 or v->>'sha256' is null or v->>'sha256' !~ '^[0-9a-f]{64}$' then raise exception 'Evidence binding mismatch'; end if;
 if e.submitted_at is not null then
  if e.sha256 is distinct from v->>'sha256' then raise exception 'Evidence conflict'; end if;
  return;
 end if;
 if a.status not in ('accepted','revision_requested') or e.submission_round<>a.submission_round then raise exception 'Invalid submission state'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='verification-evidence' and o.name=e.file_path and o.owner_id=u::text
  and (o.metadata->>'size')::bigint=e.byte_size and o.metadata->>'mimetype'=e.mime_type) then raise exception 'Private uploaded object required'; end if;
 update public.task_evidence set sha256=v->>'sha256',submitted_at=now() where id=e.id;
 update public.task_assignments set status='submitted',updated_at=now() where id=a.id;
 insert into public.assignment_events(assignment_id,actor_id,action,evidence_id) values(a.id,u,'submitted',e.id);
end $$;

-- Private objects are immutable. No overwrite/delete grants through this bucket's policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('verification-evidence','verification-evidence',false,8388608,array['image/jpeg','image/png','image/webp']);
create function public.can_upload_task_evidence(path text) returns boolean language sql stable security definer set search_path='' as $$
 select public.phase3b_ready() and exists(select 1 from public.task_evidence e join public.task_assignments a on a.id=e.assignment_id
 join public.verification_requests r on r.id=a.verification_request_id join public.verification_plans p on p.id=a.plan_id
 where e.file_path=path and e.verifier_id=auth.uid() and a.verifier_id=auth.uid() and public.is_assigned_verifier(r.id,a.plan_id)
 and e.submitted_at is null and e.submission_round=a.submission_round and a.status in ('accepted','revision_requested') and r.expiration>now()
 and p.accepted_at is not null and p.provenance='serv_server_v1' and p.generated_by=r.created_by and p.version=1 and p.request_fingerprint=r.request_fingerprint)
$$;
create function public.can_read_task_evidence(path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.task_evidence e where e.file_path=path and public.can_read_assignment(e.assignment_id))
$$;
create policy evidence_object_insert on storage.objects for insert to authenticated with check(
 bucket_id='verification-evidence' and storage.allow_only_operation('object.upload') and owner_id=auth.uid()::text and public.can_upload_task_evidence(name));
create policy evidence_object_select on storage.objects for select to authenticated using(
 bucket_id='verification-evidence' and storage.allow_only_operation('object.get_authenticated') and public.can_read_task_evidence(name));
-- Restrictive policies also constrain any pre-existing broad authenticated policies.
create policy evidence_object_insert_guard on storage.objects as restrictive for insert to authenticated with check(
 bucket_id<>'verification-evidence' or (storage.allow_only_operation('object.upload') and owner_id=auth.uid()::text and public.can_upload_task_evidence(name)));
create policy evidence_object_select_guard on storage.objects as restrictive for select to authenticated using(
 bucket_id<>'verification-evidence' or (storage.allow_only_operation('object.get_authenticated') and public.can_read_task_evidence(name)));
create policy evidence_object_update_guard on storage.objects as restrictive for update to authenticated using(bucket_id<>'verification-evidence') with check(bucket_id<>'verification-evidence');
create policy evidence_object_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'verification-evidence');
create policy evidence_object_anon_guard on storage.objects as restrictive for all to anon using(bucket_id<>'verification-evidence') with check(bucket_id<>'verification-evidence');
revoke all on function public.phase3b_ready(),public.is_assigned_verifier(text,uuid),public.can_read_assignment(uuid),public.assign_verification(text,uuid,uuid),public.transition_assignment(uuid,text,uuid,text),public.reserve_task_evidence(uuid,uuid,text,text,integer,jsonb),public.submit_task_evidence(text,text),public.can_upload_task_evidence(text),public.can_read_task_evidence(text) from public,anon,authenticated;
grant execute on function public.phase3b_ready(),public.is_assigned_verifier(text,uuid),public.can_read_assignment(uuid),public.assign_verification(text,uuid,uuid),public.transition_assignment(uuid,text,uuid,text),public.reserve_task_evidence(uuid,uuid,text,text,integer,jsonb),public.submit_task_evidence(text,text),public.can_upload_task_evidence(text),public.can_read_task_evidence(text) to authenticated;
commit;
