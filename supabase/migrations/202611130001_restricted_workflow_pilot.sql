begin;
set local lock_timeout = '5s';
-- Deploy manually after 202611120001, with BOTH database flags closed.
-- No scope is populated and no gate is changed by this migration.
do $$ begin
 if not exists(select 1 from spotly_private.workflow_gate where singleton and not enabled and not live_checks_verified) then
  raise exception 'Close both workflow gate flags before deploying pilot restrictions';
 end if;
 if not exists(select 1 from pg_proc where oid='public.ensure_dispatcher_workspace()'::regprocedure
  and position('role=''dispatcher''' in regexp_replace(prosrc,'\s+','','g'))>0) then
  raise exception 'Apply dispatcher workspace role migration 202611120001 first';
 end if;
end $$;

create table spotly_private.workflow_pilot (
 singleton boolean primary key default true check(singleton),
 request_id text not null references public.verification_requests(id),
 plan_id uuid not null references public.verification_plans(id),
 workspace_id uuid not null references public.workspaces(id),
 dispatcher_id uuid not null references auth.users(id),
 verifier_id uuid not null references auth.users(id),
 check(dispatcher_id<>verifier_id)
);
alter table spotly_private.workflow_pilot enable row level security;
revoke all on spotly_private.workflow_pilot from public,anon,authenticated;

-- A boolean predicate only: no signing material, identity lists or data returned.
-- It deliberately does not depend on the gate, avoiding recursion with readiness.
create function public.phase3b_pilot_allows(request_id text, selected_plan uuid, verifier uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from spotly_private.workflow_pilot s
  join public.verification_requests r on r.id=s.request_id and r.workspace_id=s.workspace_id and r.created_by=s.dispatcher_id
  join public.verification_plans p on p.id=s.plan_id and p.verification_request_id=r.id
  join public.workspace_members d on d.workspace_id=s.workspace_id and d.user_id=s.dispatcher_id and d.role='dispatcher'
  join public.workspace_members v on v.workspace_id=s.workspace_id and v.user_id=s.verifier_id and v.role='verifier'
  where s.singleton and s.request_id=$1 and s.plan_id=$2
  and ($3 is null or s.verifier_id=$3)
  and auth.uid() in (s.dispatcher_id,s.verifier_id)
  and r.expiration>now() and p.accepted_at is not null and p.provenance='serv_server_v1'
  and p.generated_by=r.created_by and p.version=1 and p.request_fingerprint=r.request_fingerprint
  -- Also reject pre-existing assignments with a different roster or selected plan.
  and not exists(select 1 from public.task_assignments a where a.verification_request_id=r.id
   and (a.plan_id<>s.plan_id or a.verifier_id<>s.verifier_id or a.assigned_by<>s.dispatcher_id))
 )
$$;
revoke all on function public.phase3b_pilot_allows(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.phase3b_pilot_allows(text,uuid,uuid) to authenticated;

create or replace function public.phase3b_ready() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled and live_checks_verified from spotly_private.workflow_gate where singleton),false)
 and exists(select 1 from spotly_private.serv_plan_key where singleton)
 and exists(select 1 from spotly_private.workflow_pilot s
  where public.phase3b_pilot_allows(s.request_id,s.plan_id,s.verifier_id))
$$;

-- All four workflow RPCs call this under their existing request/assignment locks:
-- assignment, transition, reservation and receipt finalization.
create or replace function spotly_private.assert_current_request(request_id text, selected_plan uuid) returns void
language plpgsql set search_path='' as $$
declare r public.verification_requests; p public.verification_plans;
begin
 if not public.phase3b_ready() then raise exception 'Workflow gate closed'; end if;
 select * into r from public.verification_requests where id=request_id for update;
 select * into p from public.verification_plans where id=selected_plan and verification_request_id=r.id;
 if r.id is null or r.expiration<=now() or p.id is null or p.accepted_at is null or p.provenance<>'serv_server_v1'
 or p.generated_by is distinct from r.created_by or p.version<>1 or p.request_fingerprint is distinct from r.request_fingerprint
 then raise exception 'Trusted accepted current unexpired plan required'; end if;
 if not public.phase3b_pilot_allows(r.id,p.id) then raise exception 'Outside approved workflow pilot'; end if;
end $$;

create or replace function public.assign_verification(request_id text, selected_plan uuid, verifier uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.verification_requests; a public.task_assignments; result uuid; u uuid:=auth.uid();
begin
 select * into r from public.verification_requests where id=request_id for update;
 if u is null or not public.is_workspace_member(r.workspace_id,true) then raise exception 'Dispatcher required'; end if;
 perform spotly_private.assert_current_request(r.id,selected_plan);
 if not public.phase3b_pilot_allows(r.id,selected_plan,verifier) then raise exception 'Outside approved workflow pilot'; end if;
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

-- Direct Storage clients must pass the same pinned scope as RPC clients.
-- Keep all original state/provenance checks and every restrictive object policy.
create or replace function public.can_upload_task_evidence(path text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.phase3b_ready() and exists(select 1 from public.task_evidence e join public.task_assignments a on a.id=e.assignment_id
 join public.verification_requests r on r.id=a.verification_request_id join public.verification_plans p on p.id=a.plan_id
 where public.phase3b_pilot_allows(r.id,a.plan_id,a.verifier_id)
 and e.file_path=path and e.verifier_id=auth.uid() and a.verifier_id=auth.uid() and public.is_assigned_verifier(r.id,a.plan_id)
 and e.submitted_at is null and e.submission_round=a.submission_round and a.status in ('accepted','revision_requested') and r.expiration>now()
 and p.accepted_at is not null and p.provenance='serv_server_v1' and p.generated_by=r.created_by and p.version=1 and p.request_fingerprint=r.request_fingerprint)
$$;
-- CREATE OR REPLACE retains the existing owners/ACLs. The private assertion
-- remains inaccessible to application roles. Historical authorized reads remain
-- subject to the unchanged RLS/private Storage policies when gates are closed.
commit;
