-- Read-only deployment/configuration review. No key values, signatures, task rows or identities.
-- Function bodies are hashed only. Gate flags and Storage configuration are intentionally visible to the owner.
select jsonb_build_object(
 'migrations',(select coalesce(jsonb_agg(version order by version),'[]'::jsonb) from supabase_migrations.schema_migrations),
 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,
   'anon_select',has_table_privilege('anon',c.oid,'SELECT'),
   'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
   'application_mutations',exists(select 1 from (values ('anon'),('authenticated')) r(name)
      where has_table_privilege(r.name,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege(r.name,c.oid,'INSERT,UPDATE,REFERENCES')),
   'public_privileges',exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0)) order by n.nspname,c.relname)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and
    ((n.nspname='public' and c.relname in ('workspaces','workspace_members','verification_requests','verification_plans','task_events','task_assignments','task_evidence','assignment_events'))
    or (n.nspname='spotly_private' and c.relname in ('workflow_gate','serv_plan_key')))),
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
   'arguments',oidvectortypes(p.proargtypes),'returns',pg_get_function_result(p.oid),
   'definer',p.prosecdef,'configuration',p.proconfig,
   'body_digest',md5(regexp_replace(p.prosrc,'[[:space:]]','','g')),
   'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
   'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'public_execute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')) order by n.nspname,p.proname)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    or (n.nspname='spotly_private' and p.proname='assert_current_request')),
 'policies',(select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,
   'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname)
   from pg_policies where
    (schemaname='public' and tablename in ('workspaces','workspace_members','verification_requests','verification_plans','task_events','task_assignments','task_evidence','assignment_events'))
    or (schemaname='storage' and tablename in ('objects','buckets')) or schemaname='spotly_private'),
 'private_schema_access',(select jsonb_agg(jsonb_build_object('role',r.name,'usage',has_schema_privilege(r.name,n.oid,'USAGE'),'create',has_schema_privilege(r.name,n.oid,'CREATE')))
   from pg_namespace n cross join (values ('anon'),('authenticated')) r(name) where n.nspname='spotly_private'),
 'gate',(select jsonb_build_object('enabled',enabled,'live_checks_verified',live_checks_verified) from spotly_private.workflow_gate where singleton),
 'signing_key_present',exists(select 1 from spotly_private.serv_plan_key where singleton),
 'bucket',(select jsonb_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)
   from storage.buckets where id='verification-evidence'),
 'storage_rls',(select jsonb_agg(jsonb_build_object('table',relname,'rls',relrowsecurity)) from pg_class
   where oid in (to_regclass('storage.objects'),to_regclass('storage.buckets'))),
 'storage_operation_helper',to_regprocedure('storage.allow_only_operation(text)') is not null,
 'storage_operation_context',to_regprocedure('storage.operation()') is not null
) as live_preflight;
