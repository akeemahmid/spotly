begin;
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 1 and 100), created_at timestamptz not null default now()
);
create table public.workspace_members (
 workspace_id uuid not null references public.workspaces(id), user_id uuid not null references auth.users(id),
 role text not null check (role in ('dispatcher','verifier')), created_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create index on public.workspace_members(user_id);
create table public.verification_requests (
 id text primary key check (id ~* '^SP-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 workspace_id uuid not null references public.workspaces(id), created_by uuid not null references auth.users(id),
 title text not null check(length(title) between 1 and 100), question text not null check(length(question) between 1 and 2000),
 category text not null check(category in ('road_conditions','route_access','site_access','other')),
 location_description text not null check(length(location_description) between 1 and 300),
 latitude double precision not null check(latitude between -90 and 90), longitude double precision not null check(longitude between -180 and 180),
 evidence_requirements text[] not null check(cardinality(evidence_requirements) between 1 and 3 and evidence_requirements <@ array['photos','video','written_observation']::text[]),
 expiration timestamptz not null, approved_max_budget numeric(12,2) not null check(approved_max_budget between 0 and 1000000),
 currency text not null default 'USD' check(currency='USD'), status text not null default 'draft' check(status='draft'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 request_fingerprint text not null check(length(request_fingerprint) between 1 and 16000), check(expiration > created_at)
);
create index on public.verification_requests(workspace_id,created_at);
create table public.verification_plans (
 id uuid primary key default gen_random_uuid(), verification_request_id text not null references public.verification_requests(id),
 structured_plan jsonb not null check(jsonb_typeof(structured_plan)='object' and octet_length(structured_plan::text)<=64000), provider_model text not null check(length(provider_model) between 1 and 200),
 provider_request_id text check(length(provider_request_id)<=300), request_fingerprint text not null,
 generated_at timestamptz not null, accepted_at timestamptz, version integer not null check(version=1),
 duration_ms integer not null check(duration_ms>=0), usage jsonb,
 unique(verification_request_id,request_fingerprint,generated_at)
);
create table public.task_events (
 id uuid primary key default gen_random_uuid(), verification_request_id text not null references public.verification_requests(id),
 actor_id uuid not null references auth.users(id), event_type text not null check(event_type in ('draft_created','plan_accepted')),
 event_metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index on public.verification_plans(verification_request_id);
create index on public.task_events(verification_request_id);
-- Definer helper avoids membership policies recursively querying themselves.
create function public.is_workspace_member(w uuid, dispatcher_only boolean default false) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.workspace_members where workspace_id=w and user_id=(select auth.uid()) and (not dispatcher_only or role='dispatcher'))
$$;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.verification_requests enable row level security;
alter table public.verification_plans enable row level security;
alter table public.task_events enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(public.is_workspace_member(id));
create policy member_read on public.workspace_members for select to authenticated using(public.is_workspace_member(workspace_id));
create policy request_read on public.verification_requests for select to authenticated using(public.is_workspace_member(workspace_id));
create policy plan_read on public.verification_plans for select to authenticated using(exists(select 1 from public.verification_requests r where r.id=verification_request_id));
create policy event_read on public.task_events for select to authenticated using(exists(select 1 from public.verification_requests r where r.id=verification_request_id));
-- All mutations are narrow RPCs. No client can update status, budgets, memberships, or events directly.
revoke all on public.workspaces,public.workspace_members,public.verification_requests,public.verification_plans,public.task_events from public,anon,authenticated;
grant select on public.workspaces,public.workspace_members,public.verification_requests,public.verification_plans,public.task_events to authenticated;
create function public.ensure_dispatcher_workspace() returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; u uuid := auth.uid();
begin
 if u is null then raise exception 'Authentication required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select workspace_id into w from public.workspace_members where user_id=u order by created_at,workspace_id limit 1;
 if w is null then
  insert into public.workspaces(name) values('My Spotly workspace') returning id into w;
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'dispatcher');
 end if;
 return w;
end $$;
create function public.create_verification(p jsonb, w uuid, fingerprint text, importing boolean default false) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); amount numeric; created timestamptz; task_id text; plan jsonb;
begin
 if octet_length(p::text)>64000 then raise exception 'Payload too large'; end if;
 if u is null or not public.is_workspace_member(w,true) then raise exception 'Dispatcher access required'; end if;
 amount := (p->>'budget')::numeric;
 if amount*100 <> trunc(amount*100) then raise exception 'Fractional cents are invalid'; end if;
 if not importing and (p->>'expiresAt')::timestamptz <= now() then raise exception 'Expiration must be future'; end if;
 created := case when importing then (p->>'createdAt')::timestamptz else now() end;
 if created > now() then raise exception 'Invalid creation time'; end if;
 task_id := p->>'id';
 -- Plain INSERT deliberately rejects duplicate IDs, including other workspaces. Never upsert.
 insert into public.verification_requests(id,workspace_id,created_by,title,question,category,location_description,latitude,longitude,evidence_requirements,expiration,approved_max_budget,created_at,request_fingerprint)
 values(task_id,w,u,p->>'title',p->>'question',p->>'category',p->>'locationDescription',(p#>>'{coordinates,latitude}')::float8,(p#>>'{coordinates,longitude}')::float8,array(select jsonb_array_elements_text(p->'evidenceRequirements')),(p->>'expiresAt')::timestamptz,amount,created,fingerprint);
 insert into public.task_events(verification_request_id,actor_id,event_type,event_metadata) values(task_id,u,'draft_created',jsonb_build_object('imported',importing));
 plan := p->'acceptedPlan';
 if importing and plan is not null and plan <> 'null'::jsonb then
  if plan->>'fingerprint' <> fingerprint then raise exception 'Stale imported plan'; end if;
  insert into public.verification_plans(verification_request_id,structured_plan,provider_model,provider_request_id,request_fingerprint,generated_at,accepted_at,version,duration_ms,usage)
  values(task_id,plan->'plan',plan->>'model',plan->>'providerRequestId',fingerprint,(plan->>'generatedAt')::timestamptz,(plan->>'acceptedAt')::timestamptz,(plan->>'version')::int,(plan->>'durationMs')::int,plan->'usage');
 end if;
 return task_id;
end $$;
create function public.save_verification_plan(task_id text, p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare r public.verification_requests; u uuid := auth.uid();
begin
 if octet_length(p::text)>64000 then raise exception 'Payload too large'; end if;
 select * into r from public.verification_requests where id=task_id for update;
 if u is null or r.created_by is distinct from u or not public.is_workspace_member(r.workspace_id,true) then raise exception 'Owner dispatcher access required'; end if;
 if r.expiration<=now() or p->>'fingerprint' is distinct from r.request_fingerprint then raise exception 'Expired or changed request'; end if;
 insert into public.verification_plans(verification_request_id,structured_plan,provider_model,provider_request_id,request_fingerprint,generated_at,version,duration_ms,usage)
 values(task_id,p->'plan',p->>'model',p->>'providerRequestId',p->>'fingerprint',(p->>'generatedAt')::timestamptz,(p->>'version')::int,(p->>'durationMs')::int,p->'usage') on conflict do nothing;
end $$;
create function public.accept_verification_plan(task_id text, fingerprint text, generated timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare r public.verification_requests; u uuid:=auth.uid();
begin
 select * into r from public.verification_requests where id=task_id for update;
 if u is null or r.created_by is distinct from u or not public.is_workspace_member(r.workspace_id,true) then raise exception 'Owner dispatcher access required'; end if;
 if r.expiration<=now() or fingerprint is distinct from r.request_fingerprint then raise exception 'Expired or changed request'; end if;
 update public.verification_plans set accepted_at=now() where verification_request_id=task_id and request_fingerprint=fingerprint and generated_at=generated and accepted_at is null;
 if not found then raise exception 'Plan unavailable or already accepted'; end if;
 insert into public.task_events(verification_request_id,actor_id,event_type) values(task_id,u,'plan_accepted');
end $$;
revoke all on function public.is_workspace_member(uuid,boolean),public.ensure_dispatcher_workspace(),public.create_verification(jsonb,uuid,text,boolean),public.save_verification_plan(text,jsonb),public.accept_verification_plan(text,text,timestamptz) from public,anon;
grant execute on function public.is_workspace_member(uuid,boolean),public.ensure_dispatcher_workspace(),public.create_verification(jsonb,uuid,text,boolean),public.save_verification_plan(text,jsonb),public.accept_verification_plan(text,text,timestamptz) to authenticated;
commit;
