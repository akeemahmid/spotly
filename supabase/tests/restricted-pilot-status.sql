-- SANITIZED TEMPLATE: replace example.invalid identities and REPLACE_WITH_REVIEWED_*
-- only in a private reviewed copy. Not an executable production runbook.
-- Administrator READ ONLY, AFTER migration 202611130001.
select enabled,live_checks_verified from spotly_private.workflow_gate where singleton;
select request_id,plan_id,workspace_id,dispatcher_id,verifier_id
from spotly_private.workflow_pilot where singleton;
select c.relrowsecurity as scope_rls,
 not exists(select 1 from pg_policy where polrelid=c.oid) as no_scope_policies,
 not has_schema_privilege('authenticated','spotly_private','USAGE,CREATE')
  and not has_schema_privilege('anon','spotly_private','USAGE,CREATE') as private_schema_closed,
 not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
  and not has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') as scope_grants_closed,
 not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0) as no_public_scope_grants
from pg_class c where c.oid='spotly_private.workflow_pilot'::regclass;
with expected(signature,definer,app_execute) as (values
 ('public.ensure_dispatcher_workspace()',true,true),
 ('public.phase3b_pilot_allows(text,uuid,uuid)',true,true),
 ('public.phase3b_ready()',true,true),
 ('spotly_private.assert_current_request(text,uuid)',false,false),
 ('public.assign_verification(text,uuid,uuid)',true,true),
 ('public.can_upload_task_evidence(text)',true,true)
)
select e.signature,p.oid is not null as installed,
 p.prosecdef=e.definer as security_mode_correct,
 p.proconfig @> array['search_path=""'] as fixed_search_path,
 has_function_privilege('authenticated',p.oid,'EXECUTE')=e.app_execute as authenticated_acl_correct,
 not has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_denied,
 not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  where a.grantee=0 and a.privilege_type='EXECUTE') as public_denied
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature);
select u.id as c_user_id,m.workspace_id,m.role,m.created_at
from auth.users u left join public.workspace_members m on m.user_id=u.id
where lower(u.email)='verifier@example.invalid'
order by m.created_at,m.workspace_id;
