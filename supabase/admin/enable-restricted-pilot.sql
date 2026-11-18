-- SANITIZED TEMPLATE: replace example.invalid identities and REPLACE_WITH_REVIEWED_*
-- only in a private reviewed copy. Not an executable production runbook.
-- MANUAL postgres administrator action ONLY AFTER isolated SQL, real dedicated
-- account/Storage tests, signing comparison and production read-denial checks pass.
-- Change ONLY the false literal below to true AFTER recording those results.
-- The checked-in file refuses activation. Never use this acknowledgement as test evidence.
do $enable$
declare
 live_checks_passed constant boolean := false;
 o uuid; c uuid; s spotly_private.workflow_pilot;
begin
 if current_user<>'postgres' then raise exception 'Run manually as postgres administrator'; end if;
 if not live_checks_passed then raise exception 'Stop: complete and record live security checks first'; end if;
 perform set_config('lock_timeout','5s',true);
 lock table spotly_private.workflow_pilot in share mode;
 lock table public.workspace_members in share mode;
 perform 1 from spotly_private.workflow_gate where singleton for update;
 if not found then raise exception 'Workflow gate row missing'; end if;
 select id into strict o from auth.users where lower(email)='dispatcher@example.invalid' for share;
 select id into strict c from auth.users where lower(email)='verifier@example.invalid' for share;
 select * into strict s from spotly_private.workflow_pilot where singleton;
 if s.request_id<>'REPLACE_WITH_REVIEWED_REQUEST_ID'
 or s.plan_id<>'REPLACE_WITH_REVIEWED_PLAN_UUID'::uuid
 or s.workspace_id<>'REPLACE_WITH_REVIEWED_WORKSPACE_UUID'::uuid
 or s.dispatcher_id<>o or s.verifier_id<>c or o=c then raise exception 'Pilot identity/scope mismatch'; end if;
 perform 1 from public.verification_requests r
 join public.verification_plans p on p.id=s.plan_id and p.verification_request_id=r.id
 where r.id=s.request_id and r.workspace_id=s.workspace_id and r.created_by=o and r.status='draft'
 and r.expiration>now() and not ('video'=any(r.evidence_requirements))
 and p.accepted_at is not null and p.provenance='serv_server_v1' and p.generated_by=o
 and p.version=1 and p.request_fingerprint=r.request_fingerprint
 and p.receipt_signature ~ '^[0-9a-f]{64}$'
 for share of r,p;
 if not found then raise exception 'Accepted plan/request no longer eligible'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id=s.workspace_id and user_id=o and role='dispatcher')
 or not exists(select 1 from public.workspace_members where workspace_id=s.workspace_id and user_id=c and role='verifier')
 or not exists(select 1 from spotly_private.serv_plan_key where singleton)
 then raise exception 'Required memberships/signing configuration missing'; end if;
 if exists(select 1 from public.task_assignments where verification_request_id=s.request_id
  and (plan_id<>s.plan_id or verifier_id<>c or assigned_by<>o)) then raise exception 'Conflicting existing assignment'; end if;
 update spotly_private.workflow_gate set enabled=true,live_checks_verified=true where singleton;
 raise notice 'Restricted database pilot enabled. Only the pinned request/plan and dispatcher/verifier may mutate field activity.';
exception when no_data_found or too_many_rows then
 raise exception 'Activation cancelled: missing or ambiguous identity/scope';
end;
$enable$;
