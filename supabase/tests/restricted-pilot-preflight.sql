-- SANITIZED TEMPLATE: replace example.invalid identities and REPLACE_WITH_REVIEWED_*
-- only in a private reviewed copy. Not an executable production runbook.
-- Administrator READ ONLY. Run before deployment and save the two row hashes
-- privately; rerun afterward and compare. No credentials/signatures returned.
select version from supabase_migrations.schema_migrations order by version;
select enabled,live_checks_verified
from spotly_private.workflow_gate where singleton;
with o as (
 select id from auth.users where lower(email)='dispatcher@example.invalid'
), c as (
 select id from auth.users where lower(email)='verifier@example.invalid'
)
select
 (select count(*) from o) as owner_auth_matches,
 (select count(*) from c) as verifier_auth_matches,
 array(select id from o) as owner_auth_uuids,
 array(select id from c) as verifier_auth_uuids,
 r.id as request_id,r.workspace_id,r.created_by,r.expiration,r.approved_max_budget,r.status,
 p.id as plan_id,p.accepted_at,p.provenance,
 exists(select 1 from o where id=r.created_by) as owner_matches,
 r.workspace_id='REPLACE_WITH_REVIEWED_WORKSPACE_UUID'::uuid as workspace_matches,
 exists(select 1 from public.workspace_members m join o on o.id=m.user_id
  where m.workspace_id=r.workspace_id and m.role='dispatcher') as owner_dispatcher,
 exists(select 1 from public.workspace_members m join c on c.id=m.user_id
  where m.workspace_id=r.workspace_id and m.role='verifier' and m.user_id<>r.created_by) as c_approved,
 exists(select 1 from public.workspace_members m join c on c.id=m.user_id
  where m.workspace_id<>r.workspace_id and m.role='dispatcher') as c_original_dispatcher_preserved,
 r.expiration>now() as unexpired,
 p.accepted_at is not null and p.provenance='serv_server_v1' and p.generated_by=r.created_by
  and p.version=1 and p.request_fingerprint=r.request_fingerprint
  and p.receipt_signature ~ '^[0-9a-f]{64}$' as accepted_plan_valid,
 not ('video'=any(r.evidence_requirements)) as supported_evidence,
 encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex') as request_row_hash,
 encode(extensions.digest(to_jsonb(p)::text,'sha256'),'hex') as plan_row_hash,
 (select count(*) from public.task_assignments a where a.verification_request_id=r.id) as existing_assignments
from public.verification_requests r
left join public.verification_plans p
 on p.id='REPLACE_WITH_REVIEWED_PLAN_UUID'::uuid and p.verification_request_id=r.id
where r.id='REPLACE_WITH_REVIEWED_REQUEST_ID';

-- Verify the existing execution ACL before replacing this function.
select p.prosecdef as security_definer,p.proconfig,
 pg_get_userbyid(p.proowner) as owner,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
 exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute,
 position('role=''dispatcher''' in regexp_replace(p.prosrc,'\s+','','g'))>0 as dispatcher_filter_installed
from pg_proc p where p.oid='public.ensure_dispatcher_workspace()'::regprocedure;
