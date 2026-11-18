begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
 if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto' and n.nspname='extensions') then
  raise exception 'pgcrypto must be available in extensions schema; review extension configuration before applying';
 end if;
end $$;
-- No application role may read the signing key, including through the Data API.
create schema if not exists spotly_private;
revoke all on schema spotly_private from public,anon,authenticated;
create table spotly_private.serv_plan_key (
 singleton boolean primary key default true check(singleton),
 key_hex text not null check(key_hex ~ '^[0-9a-fA-F]{64}$')
);
alter table spotly_private.serv_plan_key enable row level security;
revoke all on spotly_private.serv_plan_key from public,anon,authenticated;
-- Provision the key separately as database owner. Never put a real key in a migration.
alter table public.verification_plans
 add column provenance text not null default 'legacy_untrusted' check(provenance in ('legacy_untrusted','serv_server_v1')),
 add column generated_by uuid references auth.users(id),
 add column receipt_signature text;
alter table public.verification_plans add constraint trusted_serv_binding check(
 provenance <> 'serv_server_v1' or (generated_by is not null and receipt_signature is not null and receipt_signature ~ '^[0-9a-f]{64}$')
);
-- Close both old public RPC paths. Imports can retain historical text, but its default provenance stays untrusted.
drop function public.save_verification_plan(text,jsonb);
drop function public.accept_verification_plan(text,text,timestamptz);
create function public.save_verified_serv_plan(payload text, signature text) returns uuid
language plpgsql security definer set search_path='' as $$
declare envelope jsonb; p jsonb; r public.verification_requests; u uuid:=auth.uid(); secret text; expected bytea; supplied bytea; difference integer:=0; i integer; result uuid;
begin
 if u is null then raise exception 'Authentication required'; end if;
 if payload is null or octet_length(payload)>64000 or signature is null or signature !~ '^[0-9a-f]{64}$' then raise exception 'Invalid receipt'; end if;
 select key_hex into secret from spotly_private.serv_plan_key where singleton;
 if secret is null then raise exception 'Plan signing is not configured'; end if;
 expected:=extensions.hmac(convert_to(payload,'UTF8'),decode(secret,'hex'),'sha256');
 supplied:=decode(signature,'hex');
 -- Compare all fixed-length bytes rather than leaking a matching prefix.
 for i in 0..31 loop difference:=difference | (get_byte(expected,i) # get_byte(supplied,i)); end loop;
 if difference<>0 then raise exception 'Invalid receipt'; end if;
 envelope:=payload::jsonb; p:=envelope->'plan';
 if envelope->>'purpose' is distinct from 'spotly.serv.plan.v1' or envelope->>'userId' is distinct from u::text or p->>'version' is distinct from '1' then raise exception 'Invalid receipt binding'; end if;
 select * into r from public.verification_requests where id=envelope->>'requestId' for update;
 if r.created_by is distinct from u or not public.is_workspace_member(r.workspace_id,true) then raise exception 'Owner dispatcher access required'; end if;
 if r.expiration<=now() or p->>'fingerprint' is distinct from r.request_fingerprint or (p->>'generatedAt')::timestamptz < now()-interval '5 minutes' or (p->>'generatedAt')::timestamptz > now()+interval '30 seconds' then raise exception 'Expired or stale plan'; end if;
 insert into public.verification_plans(verification_request_id,structured_plan,provider_model,provider_request_id,request_fingerprint,generated_at,version,duration_ms,usage,provenance,generated_by,receipt_signature)
 values(r.id,p->'plan',p->>'model',p->>'providerRequestId',p->>'fingerprint',(p->>'generatedAt')::timestamptz,1,(p->>'durationMs')::int,p->'usage','serv_server_v1',u,signature)
 returning id into result;
 -- Deliberately no conflict upsert: an existing untrusted row must never be promoted.
 return result;
end $$;
create function public.accept_verified_serv_plan(task_id text, plan_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.verification_requests; p public.verification_plans; u uuid:=auth.uid();
begin
 select * into r from public.verification_requests where id=task_id for update;
 if u is null or r.created_by is distinct from u or not public.is_workspace_member(r.workspace_id,true) then raise exception 'Owner dispatcher access required'; end if;
 select * into p from public.verification_plans where id=plan_id and verification_request_id=r.id for update;
 if p.id is null or p.provenance<>'serv_server_v1' or p.generated_by is distinct from u or p.version<>1 or p.request_fingerprint is distinct from r.request_fingerprint or r.expiration<=now() then raise exception 'Untrusted, stale or unavailable plan'; end if;
 -- Idempotent acceptance supports retry after a lost HTTP response without duplicating events.
 if p.accepted_at is not null then return; end if;
 update public.verification_plans set accepted_at=now() where id=p.id;
 insert into public.task_events(verification_request_id,actor_id,event_type,event_metadata) values(r.id,u,'plan_accepted',jsonb_build_object('plan_id',p.id,'provenance','serv_server_v1'));
end $$;
revoke all on function public.save_verified_serv_plan(text,text),public.accept_verified_serv_plan(text,uuid) from public,anon;
grant execute on function public.save_verified_serv_plan(text,text),public.accept_verified_serv_plan(text,uuid) to authenticated;
commit;
