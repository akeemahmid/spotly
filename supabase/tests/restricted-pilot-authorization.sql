-- DISPOSABLE fully migrated Supabase database ONLY, as postgres.
-- No network/Storage API/provider calls. All synthetic rows/key/gates roll back.
begin;
set local statement_timeout = '15s';
create function public.pilot_test_denied(statement text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when insufficient_privilege or raise_exception then return;
 end;
 raise exception 'Unexpected pilot allow: %',statement;
end $$;
revoke all on function public.pilot_test_denied(text) from public;
grant execute on function public.pilot_test_denied(text) to authenticated,anon;

insert into auth.users(id)
select ('13000000-0000-4000-8000-00000000000'||n)::uuid from generate_series(1,5) n;
insert into public.workspaces(id,name) values
 ('24000000-0000-4000-8000-000000000001','Pilot'),
 ('24000000-0000-4000-8000-000000000002','Unrelated eligible workspace');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('24000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','dispatcher'),
 ('24000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002','verifier'),
 ('24000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000003','dispatcher'),
 ('24000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000004','verifier'),
 ('24000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000003','dispatcher'),
 ('24000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000005','verifier');
insert into public.verification_requests(id,workspace_id,created_by,title,question,category,location_description,latitude,longitude,evidence_requirements,expiration,approved_max_budget,request_fingerprint)
select 'SP-35000000-0000-4000-8000-00000000000'||n,
 case when n=3 then '24000000-0000-4000-8000-000000000002' else '24000000-0000-4000-8000-000000000001' end::uuid,
 case when n=3 then '13000000-0000-4000-8000-000000000003' else '13000000-0000-4000-8000-000000000001' end::uuid,
 'Synthetic pilot fixture','Synthetic question','other','Synthetic location',0,0,array['photos'],now()+interval '1 day',0,'pilot-fixture'
from generate_series(1,3) n;
insert into public.verification_plans(id,verification_request_id,structured_plan,provider_model,request_fingerprint,generated_at,accepted_at,version,duration_ms,provenance,generated_by,receipt_signature)
select ('46000000-0000-4000-8000-00000000000'||n)::uuid,r.id,'{}','synthetic-fixture',r.request_fingerprint,now(),now(),1,0,'serv_server_v1',r.created_by,repeat('ef',32)
from public.verification_requests r join generate_series(1,3) n on r.id='SP-35000000-0000-4000-8000-00000000000'||n;
-- A different, otherwise accepted plan for the exact same request must also deny.
insert into public.verification_plans(id,verification_request_id,structured_plan,provider_model,request_fingerprint,generated_at,accepted_at,version,duration_ms,provenance,generated_by,receipt_signature)
select '46000000-0000-4000-8000-000000000004',verification_request_id,'{}',provider_model,request_fingerprint,now()-interval '1 minute',now(),1,0,provenance,generated_by,receipt_signature
from public.verification_plans where id='46000000-0000-4000-8000-000000000001';
insert into spotly_private.serv_plan_key(singleton,key_hex) values(true,repeat('cd',32)) on conflict(singleton) do update set key_hex=excluded.key_hex;
-- spotly:case empty pilot scope fails closed
update spotly_private.workflow_gate set enabled=true,live_checks_verified=true;
set local role authenticated;
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
do $$ begin if public.phase3b_ready() then raise exception 'Empty pilot scope failed open'; end if; end $$;
select public.pilot_test_denied($q$select public.assign_verification('SP-35000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002')$q$);
reset role;
-- spotly:case exact pilot readiness and private scope management denial
insert into spotly_private.workflow_pilot(singleton,request_id,plan_id,workspace_id,dispatcher_id,verifier_id) values
 (true,'SP-35000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001',
 '24000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$ begin
 if not public.phase3b_ready() then raise exception 'Configured pilot unavailable'; end if;
 if public.phase3b_pilot_allows('SP-35000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000001') then raise exception 'Request argument not bound'; end if;
end $$;
select public.pilot_test_denied('select * from spotly_private.workflow_pilot');
select public.pilot_test_denied('delete from spotly_private.workflow_pilot');
select public.pilot_test_denied('update spotly_private.workflow_gate set enabled=true');
-- spotly:case wrong request, accepted plan and verifier all denied
-- Right owner/workspace but wrong request, plan or verifier.
select public.pilot_test_denied($q$select public.assign_verification('SP-35000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000002')$q$);
select public.pilot_test_denied($q$select public.assign_verification('SP-35000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000004','13000000-0000-4000-8000-000000000002')$q$);
select public.pilot_test_denied($q$select public.assign_verification('SP-35000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000004')$q$);
-- spotly:case other dispatcher and other eligible workspace excluded
-- Another authorized dispatcher in the SAME workspace must not use this pilot.
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000003',true);
do $$ begin if public.phase3b_ready() then raise exception 'Other dispatcher became ready'; end if; end $$;
select public.pilot_test_denied($q$select public.assign_verification('SP-35000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002')$q$);
-- Unrelated workspace has a valid owner, verifier AND accepted plan, but is excluded.
select public.pilot_test_denied($q$select public.assign_verification('SP-35000000-0000-4000-8000-000000000003','46000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000005')$q$);
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
-- spotly:case authorized scoped assignment, acceptance and upload eligibility
select public.assign_verification('SP-35000000-0000-4000-8000-000000000001','46000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000002',true);
select public.transition_assignment((select id from public.task_assignments where verification_request_id='SP-35000000-0000-4000-8000-000000000001'),'accept');
select public.reserve_task_evidence('57000000-0000-4000-8000-000000000001',(select id from public.task_assignments where verification_request_id='SP-35000000-0000-4000-8000-000000000001'),'Synthetic','image/png',10);
do $$ begin
 if not public.can_upload_task_evidence((select file_path from public.task_evidence where id='57000000-0000-4000-8000-000000000001')) then raise exception 'Pilot upload eligibility failed'; end if;
end $$;
-- spotly:case historical out-of-scope transitions, reservations, receipts and uploads denied
-- Seed an old accepted assignment/reservation outside scope, owned by pilot A/C.
-- Read authorization remains historical; ALL new mutations/uploads must deny.
reset role;
insert into public.task_assignments(id,verification_request_id,plan_id,verifier_id,assigned_by,status) values
 ('68000000-0000-4000-8000-000000000001','SP-35000000-0000-4000-8000-000000000002','46000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000001','accepted');
insert into public.task_evidence(id,assignment_id,verifier_id,submission_round,file_path,mime_type,byte_size,observation) values
 ('57000000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000002',1,'68000000-0000-4000-8000-000000000001/57000000-0000-4000-8000-000000000002','image/png',10,'Synthetic');
-- Satisfy the original finalization preconditions so only the pilot boundary
-- rejects the valid out-of-scope receipt, rather than a missing object.
insert into storage.objects(bucket_id,name,owner_id,metadata) values
 ('verification-evidence','68000000-0000-4000-8000-000000000001/57000000-0000-4000-8000-000000000002',
 '13000000-0000-4000-8000-000000000002','{"size":10,"mimetype":"image/png"}');
create temporary table pilot_receipt(payload text,signature text);
insert into pilot_receipt(payload) select jsonb_build_object('purpose','spotly.evidence.v1','id',id,'assignmentId',assignment_id,'userId',verifier_id,'path',file_path,'observation',observation,'location',null,'mime',mime_type,'size',byte_size,'sha256',repeat('ef',32),'issuedAt',now())::text from public.task_evidence where id='57000000-0000-4000-8000-000000000002';
update pilot_receipt set signature=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(repeat('cd',32),'hex'),'sha256'),'hex');
grant select on pilot_receipt to authenticated;
set local role authenticated;
select public.pilot_test_denied($q$select public.transition_assignment('68000000-0000-4000-8000-000000000001','accept')$q$);
-- An otherwise valid exact reservation retry must also fail outside scope.
select public.pilot_test_denied($q$select public.reserve_task_evidence('57000000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000001','Synthetic','image/png',10)$q$);
select public.pilot_test_denied('select public.submit_task_evidence(payload,signature) from pilot_receipt');
do $$ begin
 if public.can_upload_task_evidence('68000000-0000-4000-8000-000000000001/57000000-0000-4000-8000-000000000002') then raise exception 'Other request upload allowed'; end if;
end $$;
select set_config('storage.operation','storage.object.upload',true);
select public.pilot_test_denied($q$insert into storage.objects(bucket_id,name,owner_id,metadata) values('verification-evidence','68000000-0000-4000-8000-000000000001/57000000-0000-4000-8000-000000000002',auth.uid()::text,'{"size":10,"mimetype":"image/png"}')$q$);
-- spotly:case gate shutdown and anonymous predicate denial
-- Closing the database gate stops direct-client mutation eligibility immediately.
reset role;
update spotly_private.workflow_gate set enabled=false;
set local role authenticated;
do $$ begin if public.phase3b_ready() or public.can_upload_task_evidence((select file_path from public.task_evidence where id='57000000-0000-4000-8000-000000000001')) then raise exception 'Closed gate allowed upload'; end if; end $$;
select public.pilot_test_denied($q$select public.transition_assignment((select id from public.task_assignments where verification_request_id='SP-35000000-0000-4000-8000-000000000001'),'accept')$q$);
set local role anon;
select public.pilot_test_denied('select public.phase3b_pilot_allows(null,null,null)');
rollback;
