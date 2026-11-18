-- Short read-only schema confirmation AFTER manual migration 003.
-- All three columns must be true. This is not a live authorization/Storage API test.
select
 (select count(*)=4 and bool_and(rowsecurity) from pg_tables
  where (schemaname,tablename) in (('public','task_assignments'),
   ('public','task_evidence'),('public','assignment_events'),
   ('spotly_private','workflow_gate'))) as tables_with_rls,
 coalesce((select not b.public from storage.buckets b
  where b.id='verification-evidence'),false) as evidence_bucket_private,
 (select count(*)=7 from pg_policies
  where schemaname='storage' and tablename='objects'
   and policyname in ('evidence_object_insert','evidence_object_select',
    'evidence_object_insert_guard','evidence_object_select_guard',
    'evidence_object_update_guard','evidence_object_delete_guard',
    'evidence_object_anon_guard')) as storage_policies_present;
