-- Read-only catalog/configuration inspection. Safe for the intended linked project.
-- npx supabase db query --remote --read-only --file supabase/tests/schema-inspection.sql
-- Never include key_hex, migration statement bodies, tokens, or customer rows in output.
select jsonb_build_object(
  'migrations', (select jsonb_agg(version order by version)
    from supabase_migrations.schema_migrations where version in ('202611050001','202611050002')),
  'plan_columns', (select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) order by column_name)
    from information_schema.columns where table_schema='public' and table_name='verification_plans'
      and column_name in ('provenance','generated_by','receipt_signature')),
  'tables', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and ((n.nspname='public' and c.relname in ('workspaces','workspace_members','verification_requests','verification_plans','task_events'))
      or (n.nspname='spotly_private' and c.relname='serv_plan_key'))),
  'functions', (select jsonb_agg(jsonb_build_object(
      'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),
      'security_definer',p.prosecdef,'configuration',p.proconfig,
      'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'public_execute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('is_workspace_member','ensure_dispatcher_workspace','create_verification','save_verified_serv_plan','accept_verified_serv_plan','save_verification_plan','accept_verification_plan')),
  'table_privileges', (select jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'table',c.relname,'role',r.name,
      'select',has_table_privilege(r.name,c.oid,'SELECT'),
      'insert',has_table_privilege(r.name,c.oid,'INSERT'),
      'update',has_table_privilege(r.name,c.oid,'UPDATE'),
      'delete',has_table_privilege(r.name,c.oid,'DELETE'),
      'truncate',has_table_privilege(r.name,c.oid,'TRUNCATE')) order by n.nspname,c.relname,r.name)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join (values ('anon'),('authenticated')) r(name)
    where c.relkind='r' and ((n.nspname='public' and c.relname in ('workspaces','workspace_members','verification_requests','verification_plans','task_events'))
      or (n.nspname='spotly_private' and c.relname='serv_plan_key'))),
  'policies', (select jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check) order by schemaname,tablename,policyname)
    from pg_policies where (schemaname='public' and tablename in ('workspaces','workspace_members','verification_requests','verification_plans','task_events'))
      or (schemaname='spotly_private' and tablename='serv_plan_key')),
  'private_schema', (select jsonb_agg(jsonb_build_object('role',r.name,
      'usage',has_schema_privilege(r.name,n.oid,'USAGE'),'create',has_schema_privilege(r.name,n.oid,'CREATE')) order by r.name)
    from pg_namespace n cross join (values ('anon'),('authenticated')) r(name) where n.nspname='spotly_private')
) as phase3a_schema;
