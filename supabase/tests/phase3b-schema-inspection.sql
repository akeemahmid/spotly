-- Read-only owner inspection after manual migration 003. No keys or task rows.
select version from supabase_migrations.schema_migrations
 where version in ('202611050001','202611050002','202611110001') order by version;
select n.nspname as schema,c.relname as table,c.relrowsecurity as rls,
 has_table_privilege('anon',c.oid,'SELECT') as anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') as authenticated_any_mutation
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and
 ((n.nspname='public' and c.relname in ('task_assignments','task_evidence','assignment_events')) or (n.nspname='spotly_private' and c.relname='workflow_gate'));
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef as definer,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in
 ('phase3b_ready','is_assigned_verifier','can_read_assignment','assign_verification','transition_assignment','reserve_task_evidence','submit_task_evidence','can_upload_task_evidence','can_read_task_evidence'))
 or (n.nspname='spotly_private' and p.proname='assert_current_request') order by p.proname;
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
 where (schemaname='public' and tablename in ('workspace_members','verification_requests','verification_plans','task_events','task_assignments','task_evidence','assignment_events'))
 or (schemaname='storage' and policyname like 'evidence_object_%') or schemaname='spotly_private'
 order by schemaname,tablename,policyname;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='verification-evidence';
select enabled,live_checks_verified from spotly_private.workflow_gate where singleton;
select exists(select 1 from spotly_private.serv_plan_key where singleton) as signing_key_present;
