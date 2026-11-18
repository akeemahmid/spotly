-- SANITIZED TEMPLATE: replace example.invalid identities and REPLACE_WITH_REVIEWED_*
-- only in a private reviewed copy. Not an executable production runbook.
-- MANUAL postgres administrator action AFTER both new migrations, with gates CLOSED.
-- Resolves actual identities; inserts only private pilot configuration.
-- Never changes a membership, request, accepted plan, signing key or gate.
do $configure$
declare
 o uuid; c uuid;
 r public.verification_requests; p public.verification_plans;
 s spotly_private.workflow_pilot;
begin
 if current_user<>'postgres' then raise exception 'Run manually as postgres administrator'; end if;
 perform set_config('lock_timeout','5s',true);
 lock table spotly_private.workflow_pilot in share row exclusive mode;
 lock table public.workspace_members in share mode;
 perform 1 from spotly_private.workflow_gate where singleton and not enabled and not live_checks_verified for update;
 if not found then raise exception 'Both database workflow flags must be closed'; end if;
 select id into strict o from auth.users where lower(email)='dispatcher@example.invalid' for share;
 select id into strict c from auth.users where lower(email)='verifier@example.invalid' for share;
 if o=c then raise exception 'Dispatcher and verifier must differ'; end if;
 select * into strict r from public.verification_requests
 where id='REPLACE_WITH_REVIEWED_REQUEST_ID'
 and workspace_id='REPLACE_WITH_REVIEWED_WORKSPACE_UUID' and created_by=o for share;
 select * into strict p from public.verification_plans
 where id='REPLACE_WITH_REVIEWED_PLAN_UUID' and verification_request_id=r.id for share;
 if r.status<>'draft' or r.expiration<=now() or 'video'=any(r.evidence_requirements)
 or p.accepted_at is null or p.provenance<>'serv_server_v1' or p.generated_by is distinct from o
 or p.version<>1 or p.request_fingerprint is distinct from r.request_fingerprint
 or p.receipt_signature is null or p.receipt_signature !~ '^[0-9a-f]{64}$'
 then raise exception 'Current unexpired genuine accepted plan required'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=r.workspace_id and user_id=o and role='dispatcher')
 or not exists(select 1 from public.workspace_members where workspace_id=r.workspace_id and user_id=c and role='verifier')
 or not exists(select 1 from public.workspace_members where workspace_id<>r.workspace_id and user_id=c and role='dispatcher')
 then raise exception 'Approved dispatcher/verifier memberships must remain intact'; end if;
 if not exists(select 1 from spotly_private.serv_plan_key where singleton) then raise exception 'Signing configuration missing'; end if;
 if exists(select 1 from public.task_assignments where verification_request_id=r.id
  and (plan_id<>p.id or verifier_id<>c or assigned_by<>o)) then raise exception 'Conflicting existing assignment'; end if;
 insert into spotly_private.workflow_pilot(singleton,request_id,plan_id,workspace_id,dispatcher_id,verifier_id)
 values(true,r.id,p.id,r.workspace_id,o,c) on conflict(singleton) do nothing;
 select * into strict s from spotly_private.workflow_pilot where singleton;
 if s.request_id<>r.id or s.plan_id<>p.id or s.workspace_id<>r.workspace_id or s.dispatcher_id<>o or s.verifier_id<>c
 then raise exception 'Existing pilot scope conflicts; no overwrite performed'; end if;
 raise notice 'Pilot scope verified. Both workflow gates remain closed.';
exception when no_data_found or too_many_rows then
 raise exception 'Configuration cancelled: expected unique identities and exact request/plan rows';
end;
$configure$;
