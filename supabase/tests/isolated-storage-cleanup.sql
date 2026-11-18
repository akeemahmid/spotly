-- Run ONLY through the target-locked Node lifecycle, after Dashboard Storage
-- deletion and gate closure. Never delete storage.objects through SQL: that
-- would orphan actual bytes. Preexisting dedicated Auth users remain untouched.
begin;
do $$ begin
 if not exists(select 1 from spotly_private.workflow_gate where singleton and not enabled and not live_checks_verified)
 or exists(select 1 from storage.objects where bucket_id='verification-evidence')
 or exists(select 1 from spotly_private.workflow_pilot)
 or exists(select 1 from spotly_private.serv_plan_key)
 then raise exception 'Closed gates, empty scope/key and Storage API cleanup required'; end if;
 if exists(select 1 from public.workspaces where id in
  ('25000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000003')
  and name not in ('Disposable storage A','Disposable storage B','Disposable C dispatcher'))
 or exists(select 1 from public.workspace_members where workspace_id in
  ('25000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000003')
  and user_id not in (select id from auth.users where email in ('pilot-a@example.test','pilot-b@example.test','pilot-c@example.test')))
 then raise exception 'Unexpected workspace/membership contents; refuse automatic deletion'; end if;
 if exists(select 1 from public.verification_requests where id in
  ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003')
  and (title<>'Synthetic Storage fixture' or approved_max_budget<>0 or status<>'draft'))
 or exists(select 1 from public.verification_plans where verification_request_id in
  ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003')
  and provider_model<>'synthetic-fixture-not-SERV')
 then raise exception 'Unexpected fixture contents; refuse automatic deletion'; end if;
end $$;
delete from public.assignment_events where assignment_id in
 (select id from public.task_assignments where verification_request_id in
 ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003'));
delete from public.task_evidence where assignment_id in
 (select id from public.task_assignments where verification_request_id in
 ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003'));
delete from public.task_assignments where verification_request_id in
 ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003');
delete from public.task_events where verification_request_id in
 ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003');
delete from public.verification_plans where verification_request_id in
 ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003');
delete from public.verification_requests where id in
 ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003');
delete from public.workspace_members where workspace_id in
 ('25000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000003');
delete from public.workspaces where id in
 ('25000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000002','25000000-0000-4000-8000-000000000003');
commit;
