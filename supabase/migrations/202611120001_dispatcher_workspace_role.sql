begin;
-- Keep workspace selection independent of older verifier memberships.
-- Existing memberships, workspace ownership, gates and plans are unchanged.
create or replace function public.ensure_dispatcher_workspace() returns uuid
language plpgsql security definer set search_path='' as $$
declare w uuid; u uuid := auth.uid();
begin
 if u is null then raise exception 'Authentication required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select workspace_id into w from public.workspace_members
 where user_id=u and role='dispatcher'
 order by created_at,workspace_id limit 1;
 if w is null then
  insert into public.workspaces(name) values('My Spotly workspace') returning id into w;
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'dispatcher');
 end if;
 return w;
end $$;
-- CREATE OR REPLACE preserves the existing function owner and execution ACL.
commit;
