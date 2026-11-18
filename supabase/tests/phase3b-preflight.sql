-- Read-only preflight. Safe catalog/configuration output only: no keys or task rows.
-- Run against the explicitly reviewed target before applying migration 003.
select jsonb_build_object(
 'migration_versions', (select coalesce(jsonb_agg(version order by version),'[]'::jsonb)
   from supabase_migrations.schema_migrations),
 'storage_operation_helper', to_regprocedure('storage.allow_only_operation(text)') is not null,
 'storage_operation_context', to_regprocedure('storage.operation()') is not null,
 'storage_objects_rls', (select relrowsecurity from pg_class where oid=to_regclass('storage.objects')),
 'storage_buckets_rls', (select relrowsecurity from pg_class where oid=to_regclass('storage.buckets')),
 'storage_bucket_mutation_policy_count', (select count(*) from pg_policy p
   where p.polrelid=to_regclass('storage.buckets') and p.polcmd in ('a','w','d','*')
   and exists(select 1 from unnest(p.polroles) r(oid) where case when r.oid=0 then true
     else pg_has_role('anon',r.oid,'USAGE') or pg_has_role('authenticated',r.oid,'USAGE') end)),
 'pgcrypto_in_extensions', exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
   where e.extname='pgcrypto' and n.nspname='extensions'),
 'signed_save_rpc', to_regprocedure('public.save_verified_serv_plan(text,text)') is not null,
 'signed_accept_rpc', to_regprocedure('public.accept_verified_serv_plan(text,uuid)') is not null,
 'membership_rls', (select relrowsecurity from pg_class where oid=to_regclass('public.workspace_members')),
 'membership_application_mutations', exists(select 1 from (values ('anon'),('authenticated')) r(name)
   where has_table_privilege(r.name,'public.workspace_members','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_any_column_privilege(r.name,'public.workspace_members','INSERT,UPDATE,REFERENCES')),
 'existing_read_policies', (select coalesce(jsonb_agg(tablename||'.'||policyname order by tablename),'[]'::jsonb)
   from pg_policies where schemaname='public' and (tablename,policyname) in
     (('workspace_members','member_read'),('verification_requests','request_read'),
      ('verification_plans','plan_read'),('task_events','event_read'))),
 'conflicting_tables', (select coalesce(jsonb_agg(n.nspname||'.'||c.relname order by c.relname),'[]'::jsonb)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where
    (n.nspname='public' and c.relname in ('task_assignments','task_evidence','assignment_events'))
    or (n.nspname='spotly_private' and c.relname='workflow_gate')),
 'conflicting_functions', (select coalesce(jsonb_agg(n.nspname||'.'||p.proname order by p.proname),'[]'::jsonb)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='public' and p.proname in ('phase3b_ready','is_assigned_verifier','can_read_assignment',
      'assign_verification','transition_assignment','reserve_task_evidence','submit_task_evidence',
      'can_upload_task_evidence','can_read_task_evidence'))
    or (n.nspname='spotly_private' and p.proname='assert_current_request')),
 'conflicting_policies', (select coalesce(jsonb_agg(schemaname||'.'||tablename||'.'||policyname order by policyname),'[]'::jsonb)
   from pg_policies where schemaname='storage' and tablename='objects' and policyname in
    ('evidence_object_insert','evidence_object_select','evidence_object_insert_guard','evidence_object_select_guard',
     'evidence_object_update_guard','evidence_object_delete_guard','evidence_object_anon_guard')),
 'conflicting_bucket', exists(select 1 from storage.buckets where id='verification-evidence' or name='verification-evidence')
) as preflight;
