-- Manual Node entry: node scripts/run-security-authorization.mjs (test project only).
-- Everything, including fixture auth users, rolls back. No real credentials required.
begin;
insert into auth.users(id) values
 ('10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003');
insert into public.workspaces(id,name) values('20000000-0000-4000-8000-000000000001','Test A'),('20000000-0000-4000-8000-000000000002','Test B');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','dispatcher'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','verifier'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','dispatcher');
-- Dedicated disposable DB only: test key and synthetic provider fixture, rolled back below.
insert into spotly_private.serv_plan_key(singleton,key_hex) values(true,repeat('ab',32))
 on conflict(singleton) do update set key_hex=excluded.key_hex;
create temporary table test_receipts(payload text, signature text);
insert into test_receipts(payload) select jsonb_build_object(
 'purpose','spotly.serv.plan.v1','requestId','SP-30000000-0000-4000-8000-000000000001',
 'userId','10000000-0000-4000-8000-000000000001','plan',jsonb_build_object(
 'version',1,'fingerprint','test-fingerprint','model','test-fixture','generatedAt',now(),'durationMs',0,
 'plan',jsonb_build_object('summary','Test instructions','objective','Test only',
 'observationChecklist',jsonb_build_array('Observe'),'evidenceInstructions',jsonb_build_array('Record'),
 'safetyInstructions',jsonb_build_array('Stay safe'),'uncertaintyConditions',jsonb_build_array('Unknown'),
 'questionsForDispatcher','[]'::jsonb,'limitations',jsonb_build_array('Synthetic automated test fixture'))))::text;
update test_receipts set signature=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(repeat('ab',32),'hex'),'sha256'),'hex');
create temporary table test_stale_receipt as
 select jsonb_set(payload::jsonb,'{plan,fingerprint}','"stale-fingerprint"'::jsonb)::text as payload, null::text as signature from test_receipts;
update test_stale_receipt set signature=encode(extensions.hmac(convert_to(payload,'UTF8'),decode(repeat('ab',32),'hex'),'sha256'),'hex');
grant select on test_stale_receipt to authenticated;
grant select on test_receipts to authenticated;
-- spotly:case owner reads and direct budget/status mutation denial
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.create_verification(jsonb_build_object(
 'id','SP-30000000-0000-4000-8000-000000000001','title','Authorization fixture','question','Is access visible?',
 'category','road_conditions','locationDescription','Test location','coordinates',jsonb_build_object('latitude',0,'longitude',0),
 'evidenceRequirements',jsonb_build_array('photos'),'expiresAt',now()+interval '1 day','budget',12.34
),'20000000-0000-4000-8000-000000000001','test-fingerprint',false);
do $$ begin
 if (select count(*) from public.verification_requests)<>1 then raise exception 'Owner read failed'; end if;
 if (select created_by from public.verification_requests limit 1)<>auth.uid() then raise exception 'Creator impersonation'; end if;
 begin
  update public.verification_requests set status='completed';
  raise exception 'Direct transition was allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.verification_requests set approved_max_budget=0;
  raise exception 'Direct budget write was allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into public.verification_plans(id,verification_request_id,structured_plan,provider_model,request_fingerprint,generated_at,accepted_at,version,duration_ms)
 values('40000000-0000-4000-8000-000000000001','SP-30000000-0000-4000-8000-000000000001','{}','legacy-fixture','test-fingerprint',now()-interval '1 minute',now(),1,0);
set local role authenticated;
-- spotly:case forged/stale receipts, legacy acceptance, key privacy and trusted acceptance
do $$ declare receipt record; plan_id uuid; begin
 select * into receipt from test_receipts;
 begin
  perform public.save_verified_serv_plan(payload,signature) from test_stale_receipt;
  raise exception 'Stale signed plan allowed';
 exception when raise_exception then if sqlerrm<>'Expired or stale plan' then raise; end if; end;
 begin
  perform public.accept_verified_serv_plan('SP-30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001');
  raise exception 'Legacy plan accepted as trusted';
 exception when raise_exception then if sqlerrm<>'Untrusted, stale or unavailable plan' then raise; end if; end;
 begin
  perform public.save_verified_serv_plan(replace(receipt.payload,'test-fixture','forged'),receipt.signature);
  raise exception 'Forged metadata allowed';
 exception when raise_exception then if sqlerrm<>'Invalid receipt' then raise; end if; end;
 begin
  perform * from spotly_private.serv_plan_key;
  raise exception 'Key read allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.verification_plans(verification_request_id,structured_plan,provider_model,request_fingerprint,generated_at,version,duration_ms,provenance)
   values('SP-30000000-0000-4000-8000-000000000001','{}','forged','test-fingerprint',now(),1,0,'serv_server_v1');
  raise exception 'Direct forged plan insert allowed';
 exception when insufficient_privilege then null; end;
 plan_id:=public.save_verified_serv_plan(receipt.payload,receipt.signature);
 perform public.accept_verified_serv_plan('SP-30000000-0000-4000-8000-000000000001',plan_id);
 perform public.accept_verified_serv_plan('SP-30000000-0000-4000-8000-000000000001',plan_id);
 if (select count(*) from public.task_events where event_type='plan_accepted')<>1 then raise exception 'Duplicate acceptance event'; end if;
 if (select accepted_at is null from public.verification_plans where id=plan_id) then raise exception 'Acceptance not saved'; end if;
 if (select approved_max_budget from public.verification_requests limit 1)<>12.34 then raise exception 'Plan changed budget'; end if;
 if (select status from public.verification_requests limit 1)<>'draft' then raise exception 'Plan changed status'; end if;
end $$;
-- spotly:case cross-workspace reads, receipt replay and RPC denial
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.verification_requests) then raise exception 'Cross-workspace disclosure'; end if;
 if exists(select 1 from public.verification_plans) then raise exception 'Cross-workspace plan disclosure'; end if;
 begin
  perform public.save_verified_serv_plan(payload,signature) from test_receipts;
  raise exception 'Cross-user receipt replay allowed';
 exception when raise_exception then if sqlerrm<>'Invalid receipt binding' then raise; end if; end;
 if exists(select 1 from public.task_events) then raise exception 'Cross-workspace event disclosure'; end if;
 begin
  perform public.create_verification('{}','20000000-0000-4000-8000-000000000001','x',false);
  raise exception 'Cross-workspace create allowed';
 exception when raise_exception then if sqlerrm <> 'Dispatcher access required' then raise; end if; end;
 begin
  perform public.accept_verified_serv_plan('SP-30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001');
  raise exception 'Cross-workspace accept allowed';
 exception when raise_exception then if sqlerrm <> 'Owner dispatcher access required' then raise; end if; end;
end $$;
-- spotly:case verifier isolation, budget protection and membership escalation denial
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
do $$ begin
 if exists(select 1 from public.verification_requests) then raise exception 'Unassigned verifier disclosure'; end if;
 begin
  update public.verification_requests set approved_max_budget=0;
  raise exception 'Verifier budget update allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.create_verification('{}','20000000-0000-4000-8000-000000000001','x',false);
  raise exception 'Verifier create allowed';
 exception when raise_exception then if sqlerrm <> 'Dispatcher access required' then raise; end if; end;
 begin
  insert into public.workspace_members(workspace_id,user_id,role) values('20000000-0000-4000-8000-000000000002',auth.uid(),'dispatcher');
  raise exception 'Self-membership allowed';
 exception when insufficient_privilege then null; end;
end $$;
-- spotly:case anonymous read denial
set local role anon;
do $$ begin
 begin
  perform * from public.verification_requests;
  raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
