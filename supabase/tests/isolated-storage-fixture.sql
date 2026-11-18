-- MANUAL setup ONLY on a NEW DISPOSABLE Supabase project after all five migrations.
-- First create three confirmed password users in that project's Auth dashboard:
-- pilot-a@example.test, pilot-b@example.test, pilot-c@example.test.
-- Execute through scripts/run-storage-security.mjs, which closes the test gate
-- and verifies cleanup. Do not paste this file as standalone setup.
-- NEVER use the genuine plan, production signing key or production accounts here.
begin;
do $$
declare a uuid; b uuid; c uuid;
begin
 if current_user<>'postgres' then raise exception 'Administrator required'; end if;
 if exists(select 1 from public.verification_requests)
 or exists(select 1 from public.task_assignments)
 or exists(select 1 from spotly_private.serv_plan_key)
 or exists(select 1 from spotly_private.workflow_pilot)
 or not exists(select 1 from spotly_private.workflow_gate where singleton and not enabled and not live_checks_verified)
 then raise exception 'Refusing setup: requires a fresh disposable project, not the real demo'; end if;
 select id into strict a from auth.users where email='pilot-a@example.test' and email_confirmed_at is not null;
 select id into strict b from auth.users where email='pilot-b@example.test' and email_confirmed_at is not null;
 select id into strict c from auth.users where email='pilot-c@example.test' and email_confirmed_at is not null;
 insert into public.workspaces(id,name) values
  ('25000000-0000-4000-8000-000000000001','Disposable storage A'),
  ('25000000-0000-4000-8000-000000000002','Disposable storage B'),
  ('25000000-0000-4000-8000-000000000003','Disposable C dispatcher');
 insert into public.workspace_members(workspace_id,user_id,role) values
  ('25000000-0000-4000-8000-000000000001',a,'dispatcher'),
  ('25000000-0000-4000-8000-000000000001',c,'verifier'),
  ('25000000-0000-4000-8000-000000000002',b,'dispatcher'),
  ('25000000-0000-4000-8000-000000000002',c,'verifier'),
  ('25000000-0000-4000-8000-000000000003',c,'dispatcher');
 insert into public.verification_requests(id,workspace_id,created_by,title,question,category,location_description,latitude,longitude,evidence_requirements,expiration,approved_max_budget,request_fingerprint)
 select 'SP-36000000-0000-4000-8000-00000000000'||n,
  case when n=2 then '25000000-0000-4000-8000-000000000002' else '25000000-0000-4000-8000-000000000001' end::uuid,
  case when n=2 then b else a end,'Synthetic Storage fixture','Synthetic test only','other','Synthetic location',0,0,array['photos'],now()+interval '15 minutes',0,'isolated-storage-fixture'
 from generate_series(1,3) n;
 -- Match the app's compact JSON.stringify fingerprint, including UTC expiration.
 -- All three rows were created above in this previously empty disposable database.
 update public.verification_requests set request_fingerprint=
  '['||to_json(id)::text||','||to_json(title)::text||','||to_json(question)::text||','||to_json(category)::text||','||
  to_json(location_description)::text||',0,0,["photos"],'||
  to_json(to_char(expiration at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))::text||',0]'
 where id in ('SP-36000000-0000-4000-8000-000000000001','SP-36000000-0000-4000-8000-000000000002','SP-36000000-0000-4000-8000-000000000003');
 insert into public.verification_plans(id,verification_request_id,structured_plan,provider_model,request_fingerprint,generated_at,accepted_at,version,duration_ms,provenance,generated_by,receipt_signature)
 select ('47000000-0000-4000-8000-00000000000'||n)::uuid,r.id,
  jsonb_build_object('summary','Synthetic isolated rehearsal; not a SERV response.','objective','Exercise private field workflow.',
   'observationChecklist',jsonb_build_array('Describe the supplied test photo.'),'evidenceInstructions',jsonb_build_array('Use a non-sensitive test photo.'),
   'safetyInstructions',jsonb_build_array('Do not enter a road for this rehearsal.'),'uncertaintyConditions',jsonb_build_array('Test data does not establish road conditions.'),
   'questionsForDispatcher','[]'::jsonb,'limitations',jsonb_build_array('Synthetic administrator fixture only.')),
  'synthetic-fixture-not-SERV',r.request_fingerprint,now(),now(),1,0,'serv_server_v1',r.created_by,repeat('ef',32)
 from public.verification_requests r join generate_series(1,3) n on r.id='SP-36000000-0000-4000-8000-00000000000'||n;
 -- Publicly known TEST key: never put this value into the real project.
 insert into spotly_private.serv_plan_key(singleton,key_hex) values(true,repeat('cd',32));
 insert into spotly_private.workflow_pilot(singleton,request_id,plan_id,workspace_id,dispatcher_id,verifier_id)
 values(true,'SP-36000000-0000-4000-8000-000000000001','47000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',a,c);
 update spotly_private.workflow_gate set enabled=true,live_checks_verified=true where singleton;
 raise notice 'Disposable fixtures prepared. This is synthetic test configuration, not evidence that live checks passed.';
end $$;
commit;
