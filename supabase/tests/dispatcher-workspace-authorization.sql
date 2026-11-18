-- DISPOSABLE migrated Supabase database only, as postgres, after migration 202611120001.
-- Manual Node runner: node scripts/run-dispatcher-authorization.mjs (no psql required).
-- Real PostgreSQL role/RPC regression tests; synthetic users, no passwords, keys or gates.
-- No provider/Storage API calls. Every fixture change rolls back.
begin;
set local statement_timeout = '15s';
insert into auth.users(id) values
 ('12000000-0000-4000-8000-000000000001'),
 ('12000000-0000-4000-8000-000000000002'),
 ('12000000-0000-4000-8000-000000000003'),
 ('12000000-0000-4000-8000-000000000004');
insert into public.workspaces(id,name) values
 ('23000000-0000-4000-8000-000000000001','Disposable verifier workspace'),
 ('23000000-0000-4000-8000-000000000002','Disposable dispatcher workspace'),
 ('23000000-0000-4000-8000-000000000003','Disposable second dispatcher workspace');
insert into public.workspace_members(workspace_id,user_id,role,created_at) values
 ('23000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001','verifier',now()-interval '3 days'),
 ('23000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000001','dispatcher',now()-interval '2 days'),
 ('23000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000001','dispatcher',now()-interval '1 day'),
 ('23000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000002','verifier',now()-interval '3 days'),
 ('23000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000004','verifier',now()-interval '3 days'),
 ('23000000-0000-4000-8000-000000000003','12000000-0000-4000-8000-000000000004','dispatcher',now()-interval '1 day'),
 ('23000000-0000-4000-8000-000000000002','12000000-0000-4000-8000-000000000004','dispatcher',now()-interval '1 day');
set local role authenticated;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
do $$ declare first_workspace uuid; begin
 first_workspace := public.ensure_dispatcher_workspace();
 if first_workspace is distinct from '23000000-0000-4000-8000-000000000002'::uuid then
  raise exception 'Older verifier membership shadowed legitimate dispatcher membership';
 end if;
 if public.ensure_dispatcher_workspace() is distinct from first_workspace then raise exception 'Selection is not stable'; end if;
 if (select count(*) from public.workspace_members where user_id=auth.uid()) <> 3 then raise exception 'Unexpected membership creation'; end if;
 if public.is_workspace_member('23000000-0000-4000-8000-000000000001',true) then raise exception 'Verifier membership promoted'; end if;
end $$;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000004',true);
do $$ begin
 if public.ensure_dispatcher_workspace() is distinct from '23000000-0000-4000-8000-000000000002'::uuid then
  raise exception 'Dispatcher timestamp tie-break changed';
 end if;
end $$;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000002',true);
do $$ declare own_workspace uuid; begin
 own_workspace := public.ensure_dispatcher_workspace();
 if own_workspace is null or own_workspace = '23000000-0000-4000-8000-000000000001'::uuid
    or not public.is_workspace_member(own_workspace,true) then raise exception 'No personal dispatcher workspace created'; end if;
 if public.ensure_dispatcher_workspace() is distinct from own_workspace then raise exception 'Duplicate personal workspace'; end if;
 if not exists(select 1 from public.workspace_members where workspace_id='23000000-0000-4000-8000-000000000001' and user_id=auth.uid() and role='verifier') then
  raise exception 'Existing verifier role overwritten';
 end if;
 if (select count(*) from public.workspace_members where user_id=auth.uid()) <> 2 then raise exception 'Unexpected personal membership count'; end if;
end $$;
select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000003',true);
do $$ declare own_workspace uuid; begin
 own_workspace := public.ensure_dispatcher_workspace();
 if own_workspace is null or not public.is_workspace_member(own_workspace,true) then raise exception 'New dispatcher setup failed'; end if;
 if public.ensure_dispatcher_workspace() is distinct from own_workspace then raise exception 'New dispatcher retry created another workspace'; end if;
 if (select count(*) from public.workspace_members where user_id=auth.uid()) <> 1 then raise exception 'Duplicate new dispatcher membership'; end if;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin
  perform public.ensure_dispatcher_workspace();
  raise exception 'Missing identity accepted';
 exception when raise_exception then
  if sqlerrm <> 'Authentication required' then raise; end if;
 end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.ensure_dispatcher_workspace()','EXECUTE') then raise exception 'Anonymous execution allowed'; end if;
 if not has_function_privilege('authenticated','public.ensure_dispatcher_workspace()','EXECUTE') then raise exception 'Authenticated execution lost'; end if;
 if not exists(select 1 from pg_proc where oid='public.ensure_dispatcher_workspace()'::regprocedure and prosecdef and proconfig @> array['search_path=""']) then
  raise exception 'Definer/search-path hardening changed';
 end if;
end $$;
rollback;
