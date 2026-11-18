-- DISPOSABLE migrated Supabase database only, as postgres:
-- Manual Node entry: node scripts/run-security-authorization.mjs (test project only).
-- Synthetic users/receipts/Storage catalog fixtures; no real provider or Storage API calls.
-- Never run against production. All fixture changes roll back.
begin;
create function public.phase3b_test_expect_denied(statement text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when insufficient_privilege or raise_exception or check_violation or unique_violation then return;
 end;
 raise exception 'Unexpected allow: %',statement;
end $$;
revoke all on function public.phase3b_test_expect_denied(text) from public;
grant execute on function public.phase3b_test_expect_denied(text) to authenticated,anon;
insert into auth.users(id) values
 ('11000000-0000-4000-8000-000000000001'), -- dispatcher A
 ('11000000-0000-4000-8000-000000000002'), -- dispatcher B
 ('11000000-0000-4000-8000-000000000003'), -- verifier A
 ('11000000-0000-4000-8000-000000000004'); -- unassigned verifier A
insert into public.workspaces(id,name) values
 ('22000000-0000-4000-8000-000000000001','Disposable A'),('22000000-0000-4000-8000-000000000002','Disposable B'),
 ('22000000-0000-4000-8000-000000000003','Disposable C personal');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','dispatcher'),
 ('22000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','dispatcher'),
 ('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','verifier'),
 ('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','verifier'),
 ('22000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000003','dispatcher');
-- Owner-only synthetic data setup. This fixture does not claim provider provenance.
insert into spotly_private.serv_plan_key(singleton,key_hex) values(true,repeat('cd',32)) on conflict(singleton) do update set key_hex=excluded.key_hex;
insert into public.verification_requests(id,workspace_id,created_by,title,question,category,location_description,latitude,longitude,evidence_requirements,expiration,approved_max_budget,request_fingerprint)
 select 'SP-33000000-0000-4000-8000-00000000000'||n,'22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',
 'Synthetic request '||n,'Test question','road_conditions','No real location',0,0,array['photos','written_observation'],now()+interval '1 day',0,'fixture-fingerprint'
 from generate_series(1,4) n;
insert into public.verification_plans(id,verification_request_id,structured_plan,provider_model,request_fingerprint,generated_at,accepted_at,version,duration_ms,provenance,generated_by,receipt_signature)
 select ('44000000-0000-4000-8000-00000000000'||n)::uuid,'SP-33000000-0000-4000-8000-00000000000'||n,'{}','synthetic-sql-fixture','fixture-fingerprint',now(),now(),1,0,
 case when n=2 then 'legacy_untrusted' else 'serv_server_v1' end,'11000000-0000-4000-8000-000000000001',repeat('ab',32)
 from generate_series(1,4) n;
update public.verification_requests set expiration=now()-interval '1 minute',created_at=now()-interval '1 day' where id='SP-33000000-0000-4000-8000-000000000003';
update public.verification_plans set request_fingerprint='stale' where id='44000000-0000-4000-8000-000000000004';
-- Explicit disposable pilot; all configuration and synthetic key changes roll back.
insert into spotly_private.workflow_pilot(singleton,request_id,plan_id,workspace_id,dispatcher_id,verifier_id)
values(true,'SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001',
 '22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003');
-- spotly:case approved verifier membership and unassigned privacy
set local role authenticated;
-- Same membership predicate as /verifier; SQL alone does not test browser sign-in.
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.workspace_members where user_id=auth.uid() and role='verifier') then raise exception 'Unapproved portal membership'; end if;
end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
do $$ begin
 if not exists(select 1 from public.workspace_members where user_id=auth.uid() and role='verifier') then raise exception 'Approved portal membership missing'; end if;
 if exists(select 1 from public.verification_requests) or exists(select 1 from public.verification_plans) then raise exception 'C read unassigned private request'; end if;
 if not public.is_workspace_member('22000000-0000-4000-8000-000000000003',true)
    or public.is_workspace_member('22000000-0000-4000-8000-000000000001',true) then raise exception 'Dispatcher role crossed workspaces'; end if;
end $$;
-- spotly:case closed gate and administrator-only gate management
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003')$q$);
select public.phase3b_test_expect_denied('update spotly_private.workflow_gate set enabled=true,live_checks_verified=true');
reset role;
update spotly_private.workflow_gate set enabled=true,live_checks_verified=true where singleton;
-- spotly:case exact pinned plan rejects unaccepted, legacy, stale and wrong-generator states
set local role authenticated;
do $$ begin if not public.phase3b_ready() then raise exception 'Positive-control pilot unavailable'; end if; end $$;
reset role;
-- Change ONE field on the exact pinned plan at a time, rather than merely
-- testing an out-of-scope request which would hide broken provenance checks.
do $$ declare mode integer; begin
 for mode in 1..4 loop
  update public.verification_plans set
   accepted_at=case when mode=1 then null else now() end,
   provenance=case when mode=2 then 'legacy_untrusted' else 'serv_server_v1' end,
   request_fingerprint=case when mode=3 then 'stale' else 'fixture-fingerprint' end,
   generated_by=case when mode=4 then '11000000-0000-4000-8000-000000000002' else '11000000-0000-4000-8000-000000000001' end::uuid
  where id='44000000-0000-4000-8000-000000000001';
  set local role authenticated;
  perform public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003')$q$);
  reset role;
 end loop;
 update public.verification_plans set accepted_at=now(),provenance='serv_server_v1',request_fingerprint='fixture-fingerprint',generated_by='11000000-0000-4000-8000-000000000001'
 where id='44000000-0000-4000-8000-000000000001';
end $$;
-- spotly:case approved request-workspace verifier required
-- C retains the personal dispatcher membership, which cannot authorize this task.
delete from public.workspace_members where workspace_id='22000000-0000-4000-8000-000000000001' and user_id='11000000-0000-4000-8000-000000000003';
set local role authenticated;
select public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003')$q$);
reset role;
insert into public.workspace_members(workspace_id,user_id,role) values('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','verifier');
-- spotly:case authorized assignment, idempotency and direct mutation denial
set local role authenticated;
do $$ begin if not public.phase3b_ready() then raise exception 'Restored positive control unavailable'; end if; end $$;
select public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000003')$q$);
select public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000003','44000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000003')$q$);
select public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000004','44000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-000000000003')$q$);
select public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000002')$q$);
select public.assign_verification('SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003');
select public.assign_verification('SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003');
do $$ begin if (select count(*) from public.task_assignments)<>1 or (select count(*) from public.assignment_events)<>1 then raise exception 'Assignment idempotency failed'; end if; end $$;
select public.phase3b_test_expect_denied($q$select public.transition_assignment((select id from public.task_assignments limit 1),'accept')$q$);
select public.phase3b_test_expect_denied($q$update public.verification_requests set approved_max_budget=100$q$);
select public.phase3b_test_expect_denied($q$update public.task_assignments set status='completed'$q$);
-- spotly:case cross-workspace and unassigned verifier isolation
-- Preserve unrelated dispatcher B isolation, without changing B's membership.
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.verification_requests) or exists(select 1 from public.verification_plans) or exists(select 1 from public.task_assignments) or exists(select 1 from public.task_evidence) or exists(select 1 from public.assignment_events) then raise exception 'Cross-workspace disclosure'; end if;
end $$;
select public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003')$q$);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000004',true);
do $$ begin if exists(select 1 from public.verification_requests) or exists(select 1 from public.verification_plans) or exists(select 1 from public.task_assignments) then raise exception 'Unassigned verifier disclosure'; end if; end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
do $$ begin
 if (select count(*) from public.verification_requests)<>1 or (select count(*) from public.verification_plans)<>1 then raise exception 'Assigned-only visibility failed'; end if;
end $$;
-- spotly:case verifier self-assignment, budget and membership mutation denial
select public.phase3b_test_expect_denied($q$select public.assign_verification('SP-33000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001',auth.uid())$q$);
select public.phase3b_test_expect_denied($q$update public.verification_requests set approved_max_budget=100$q$);
select public.phase3b_test_expect_denied($q$insert into public.workspace_members(workspace_id,user_id,role) values('22000000-0000-4000-8000-000000000002',auth.uid(),'dispatcher')$q$);
select public.phase3b_test_expect_denied($q$select public.reserve_task_evidence('55000000-0000-4000-8000-000000000001',(select id from public.task_assignments limit 1),'Fixture','image/png',10)$q$);
-- spotly:case acceptance, invalid transitions and evidence reservation validation
select public.transition_assignment((select id from public.task_assignments limit 1),'accept');
select public.transition_assignment((select id from public.task_assignments limit 1),'accept');
select public.phase3b_test_expect_denied($q$select public.transition_assignment((select id from public.task_assignments limit 1),'decline')$q$);
select public.phase3b_test_expect_denied($q$select public.transition_assignment((select id from public.task_assignments limit 1),'complete')$q$);
select public.phase3b_test_expect_denied($q$select public.reserve_task_evidence('55000000-0000-4000-8000-000000000001',(select id from public.task_assignments limit 1),'Fixture','image/svg+xml',10)$q$);
select public.phase3b_test_expect_denied($q$select public.reserve_task_evidence('55000000-0000-4000-8000-000000000001',(select id from public.task_assignments limit 1),'Fixture','image/png',8388609)$q$);
select public.reserve_task_evidence('55000000-0000-4000-8000-000000000001',(select id from public.task_assignments limit 1),'Fixture','image/png',10);
select public.reserve_task_evidence('55000000-0000-4000-8000-000000000001',(select id from public.task_assignments limit 1),'Fixture','image/png',10);
select public.phase3b_test_expect_denied($q$select public.reserve_task_evidence('55000000-0000-4000-8000-000000000002',(select id from public.task_assignments limit 1),'Duplicate','image/png',10)$q$);
select public.phase3b_test_expect_denied($q$select public.submit_task_evidence('{}',repeat('ab',32))$q$);
-- spotly:case SQL-only Storage operation policies and signed-upload denial
-- Simulate API operation context: signed upload tokens must never be issued,
-- even for a fresh reserved path. No actual file bytes are uploaded by SQL.
select set_config('storage.operation','storage.object.sign_upload_url',true);
select public.phase3b_test_expect_denied($q$insert into storage.objects(bucket_id,name,owner_id,metadata)
 select 'verification-evidence',file_path,auth.uid()::text,'{"size":10,"mimetype":"image/png"}' from public.task_evidence where id='55000000-0000-4000-8000-000000000001'$q$);
select set_config('storage.operation','storage.object.upload',true);
insert into storage.objects(bucket_id,name,owner_id,metadata)
 select 'verification-evidence',file_path,auth.uid()::text,'{"size":10,"mimetype":"image/png"}' from public.task_evidence where id='55000000-0000-4000-8000-000000000001';
select set_config('storage.operation','storage.object.sign',true);
do $$ begin if exists(select 1 from storage.objects where bucket_id='verification-evidence') then raise exception 'Bearer download signing permitted'; end if; end $$;
select set_config('storage.operation','storage.object.list',true);
do $$ begin if exists(select 1 from storage.objects where bucket_id='verification-evidence') then raise exception 'Bucket listing permitted'; end if; end $$;
select set_config('storage.operation','storage.object.get_authenticated',true);
-- spotly:case reserved image readback before finalization and unauthorized denial
-- The app must verify stored bytes BEFORE signing a finalization receipt.
-- The display proxy still hides pending evidence; this is the Storage read path.
-- spotly:step pending_verifier_private_read
do $$ begin
 if (select count(*) from public.task_evidence where id='55000000-0000-4000-8000-000000000001' and submitted_at is null)<>1
 or (select count(*) from storage.objects where bucket_id='verification-evidence')<>1
 then raise exception 'Pending verifier readback unavailable'; end if;
end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
-- spotly:step pending_dispatcher_private_read
do $$ begin
 if (select count(*) from storage.objects where bucket_id='verification-evidence')<>1 then raise exception 'Pending authorized dispatcher read unavailable'; end if;
end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
-- spotly:step pending_cross_workspace_denied
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='verification-evidence') then raise exception 'Pending cross-workspace object disclosure'; end if;
end $$;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
-- spotly:step pending_anonymous_denied
do $$ begin
 begin
  if exists(select 1 from storage.objects where bucket_id='verification-evidence') then raise exception 'Pending anonymous object disclosure'; end if;
 exception when insufficient_privilege then null;
 end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
reset role;
-- spotly:case evidence finalization, idempotency and SQL-only immutable objects
-- spotly:step receipt_table
create temporary table evidence_receipt(payload text,signature text);
-- spotly:step receipt_payload
insert into evidence_receipt(payload)
 select jsonb_build_object('purpose','spotly.evidence.v1','id',e.id,'assignmentId',e.assignment_id,'userId',e.verifier_id,'path',e.file_path,'observation',e.observation,'location',e.location,'mime',e.mime_type,'size',e.byte_size,'sha256',repeat('ef',32),'issuedAt',now())::text
 from public.task_evidence e where e.id='55000000-0000-4000-8000-000000000001';
-- spotly:step receipt_signature
update evidence_receipt set signature=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(repeat('cd',32),'hex'),'sha256'),'hex');
-- Fail explicitly rather than letting a zero-row SELECT skip the submission RPC.
-- spotly:step receipt_and_object_fixture
do $$ begin
 if (select count(*) from evidence_receipt where payload is not null and signature ~ '^[0-9a-f]{64}$')<>1
 or (select count(*) from public.task_evidence where id='55000000-0000-4000-8000-000000000001' and submitted_at is null)<>1
 or (select count(*) from storage.objects o join public.task_evidence e on e.file_path=o.name
  where o.bucket_id='verification-evidence' and e.id='55000000-0000-4000-8000-000000000001'
  and o.owner_id=e.verifier_id::text and o.metadata='{"size":10,"mimetype":"image/png"}'::jsonb)<>1
 then raise exception 'Receipt/object fixture missing or invalid'; end if;
end $$;
-- spotly:step receipt_permissions
grant select on evidence_receipt to authenticated;
-- spotly:step verifier_submission_role
set local role authenticated;
-- spotly:step evidence_submit_first
select public.submit_task_evidence(payload,signature) from evidence_receipt;
-- spotly:step evidence_submission_state
do $$ begin
 if (select count(*) from public.task_evidence where id='55000000-0000-4000-8000-000000000001'
  and submitted_at is not null and sha256=repeat('ef',32))<>1
 or (select status from public.task_assignments limit 1) is distinct from 'submitted'
 then raise exception 'Submission transition failed'; end if;
end $$;
-- spotly:step evidence_submit_retry
select public.submit_task_evidence(payload,signature) from evidence_receipt;
-- spotly:step evidence_submission_idempotency
do $$ begin
 if (select count(*) from public.assignment_events where action='submitted')<>1 then raise exception 'Duplicate submission'; end if;
 if (select status from public.task_assignments limit 1) is distinct from 'submitted'
 or (select count(*) from public.task_evidence where id='55000000-0000-4000-8000-000000000001'
  and submitted_at is not null and sha256=repeat('ef',32))<>1 then raise exception 'Submission retry changed evidence/state'; end if;
end $$;
-- spotly:step evidence_private_read
do $$ begin
 if not exists(select 1 from storage.objects where bucket_id='verification-evidence') then raise exception 'Verifier private read failed'; end if;
end $$;
-- spotly:step submitted_upload_denied
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='verification-evidence' and public.can_upload_task_evidence(name)) then raise exception 'Submitted overwrite eligibility'; end if;
end $$;
-- Denial can be zero affected rows OR SQLSTATE 42501. Supabase Storage's
-- protect_objects_delete is a BEFORE DELETE FOR EACH STATEMENT trigger: it can
-- reject DELETE before RLS filters any rows. Never bypass that guard in a test.
-- Catch ONLY insufficient_privilege; all other failures must abort the suite.
-- spotly:step immutable_object_update
do $$ declare affected integer; begin
 begin
  update storage.objects set metadata='{}' where bucket_id='verification-evidence'; get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Storage overwrite allowed'; end if;
 exception when insufficient_privilege then null;
 end;
end $$;
-- spotly:step immutable_object_delete
do $$ declare affected integer; begin
 begin
  delete from storage.objects where bucket_id='verification-evidence'; get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Storage deletion allowed'; end if;
 exception when insufficient_privilege then null;
 end;
end $$;
-- Check as owner too: RLS must not hide a deleted or modified fixture.
-- spotly:step immutable_object_owner_role
reset role;
-- spotly:step immutable_object_preserved
do $$ begin
 if (select count(*) from storage.objects where bucket_id='verification-evidence')<>1
 or (select count(*) from storage.objects o join public.task_evidence e on e.file_path=o.name
  where o.bucket_id='verification-evidence' and e.id='55000000-0000-4000-8000-000000000001'
  and o.owner_id=e.verifier_id::text and o.metadata='{"size":10,"mimetype":"image/png"}'::jsonb)<>1
 then raise exception 'Immutable object changed or disappeared'; end if;
end $$;
set local role authenticated;
-- spotly:case verifier self-review and cross-workspace evidence denial
select public.phase3b_test_expect_denied($q$select public.transition_assignment((select id from public.task_assignments limit 1),'approve','55000000-0000-4000-8000-000000000001')$q$);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
do $$ begin if exists(select 1 from storage.objects where bucket_id='verification-evidence') then raise exception 'Cross-workspace private file disclosure'; end if; end $$;
select public.phase3b_test_expect_denied($q$select public.submit_task_evidence(payload,signature) from evidence_receipt$q$);
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select public.phase3b_test_expect_denied($q$select public.transition_assignment((select id from public.task_assignments limit 1),'complete','55000000-0000-4000-8000-000000000001')$q$);
select public.phase3b_test_expect_denied($q$select public.transition_assignment((select id from public.task_assignments limit 1),'revise','55000000-0000-4000-8000-000000000001','')$q$);
-- spotly:case dispatcher revision, multibyte receipts, review and completion
select public.transition_assignment((select id from public.task_assignments limit 1),'revise','55000000-0000-4000-8000-000000000001','Provide a clearer photograph if safe.');
select public.transition_assignment((select id from public.task_assignments limit 1),'revise','55000000-0000-4000-8000-000000000001','Provide a clearer photograph if safe.');
select public.phase3b_test_expect_denied($q$select public.transition_assignment((select id from public.task_assignments limit 1),'approve','55000000-0000-4000-8000-000000000001')$q$);
do $$ begin if (select submission_round from public.task_assignments limit 1)<>2 then raise exception 'Revision retry advanced twice'; end if; end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
select public.reserve_task_evidence('55000000-0000-4000-8000-000000000002',(select id from public.task_assignments limit 1),repeat('界',4000),'image/webp',20);
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata)
 select 'verification-evidence',file_path,verifier_id::text,'{"size":20,"mimetype":"image/webp"}' from public.task_evidence where id='55000000-0000-4000-8000-000000000002';
update evidence_receipt set payload=(select jsonb_build_object('purpose','spotly.evidence.v1','id',e.id,'assignmentId',e.assignment_id,'userId',e.verifier_id,'path',e.file_path,'observation',e.observation,'location',e.location,'mime',e.mime_type,'size',e.byte_size,'sha256',repeat('ab',32),'issuedAt',now())::text from public.task_evidence e where e.id='55000000-0000-4000-8000-000000000002');
update evidence_receipt set signature=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(repeat('cd',32),'hex'),'sha256'),'hex');
do $$ begin if (select octet_length(payload) from evidence_receipt)<=12000 then raise exception 'Multibyte receipt fixture too small'; end if; end $$;
set local role authenticated;
select public.submit_task_evidence(payload,signature) from evidence_receipt;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select public.transition_assignment((select id from public.task_assignments limit 1),'approve','55000000-0000-4000-8000-000000000002','Reviewed for stated requirements.');
select public.transition_assignment((select id from public.task_assignments limit 1),'complete','55000000-0000-4000-8000-000000000002');
select public.transition_assignment((select id from public.task_assignments limit 1),'complete','55000000-0000-4000-8000-000000000002');
do $$ begin
 if (select status from public.task_assignments limit 1)<>'completed' or (select count(*) from public.assignment_events where action='complete')<>1 then raise exception 'Completion/idempotency failed'; end if;
 if exists(select 1 from public.verification_requests where approved_max_budget<>0 or status<>'draft') then raise exception 'Immutable request changed'; end if;
end $$;
-- spotly:case expiration, membership revocation and anonymous denial
-- Expiry is rechecked on transitions, and membership revocation removes private reads.
reset role;
update public.verification_requests set expiration=now()-interval '1 minute',created_at=now()-interval '1 day' where id='SP-33000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.phase3b_test_expect_denied($q$select public.transition_assignment((select id from public.task_assignments limit 1),'complete','55000000-0000-4000-8000-000000000002')$q$);
reset role;
delete from public.workspace_members where user_id='11000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
do $$ begin if exists(select 1 from public.task_assignments) or exists(select 1 from public.task_evidence) or exists(select 1 from storage.objects where bucket_id='verification-evidence') then raise exception 'Revoked verifier disclosure'; end if; end $$;
set local role anon;
select public.phase3b_test_expect_denied('select * from public.task_assignments');
select public.phase3b_test_expect_denied('select * from public.task_evidence');
rollback;
