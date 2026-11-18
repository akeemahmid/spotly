import { check, completion } from "./security-test-db.mjs";

export const fixtureTables = ["workspaces", "workspace_members", "verification_requests", "verification_plans", "task_events", "task_assignments", "task_evidence", "assignment_events"];
// Match the versioned isolated fixture, not merely a shared workspace or prefix.
// No user-entered values or secret-bearing rows are returned by these queries.
const fixtureCTE = `with fixture_ids as (
 select n,('25000000-0000-4000-8000-00000000000'||n)::uuid workspace,
 'SP-36000000-0000-4000-8000-00000000000'||n request,
 ('47000000-0000-4000-8000-00000000000'||n)::uuid plan
 from generate_series(1,3) n
), dedicated as (
 select id,case email when 'pilot-a@example.test' then 'a' when 'pilot-b@example.test' then 'b' else 'c' end label
 from auth.users where email in ('pilot-a@example.test','pilot-b@example.test','pilot-c@example.test') and email_confirmed_at is not null
), known_workspaces as (
 select w.* from public.workspaces w join fixture_ids f on w.id=f.workspace
 where w.name=case f.n when 1 then 'Disposable storage A' when 2 then 'Disposable storage B' else 'Disposable C dispatcher' end
), known_workspace_members as (
 select m.* from public.workspace_members m join known_workspaces w on w.id=m.workspace_id join dedicated d on d.id=m.user_id
 join fixture_ids f on f.workspace=w.id where
 (f.n=1 and ((d.label='a' and m.role='dispatcher') or (d.label='c' and m.role='verifier')))
 or (f.n=2 and ((d.label='b' and m.role='dispatcher') or (d.label='c' and m.role='verifier')))
 or (f.n=3 and d.label='c' and m.role='dispatcher')
), known_verification_requests as (
 select r.* from public.verification_requests r join fixture_ids f on r.id=f.request
 join known_workspaces w on w.id=r.workspace_id join dedicated d on d.id=r.created_by
 where w.id=case when f.n=2 then (select workspace from fixture_ids where n=2) else (select workspace from fixture_ids where n=1) end
 and d.label=case when f.n=2 then 'b' else 'a' end
 and r.title='Synthetic Storage fixture' and r.question='Synthetic test only' and r.category='other'
 and r.location_description='Synthetic location' and r.latitude=0 and r.longitude=0
 and r.evidence_requirements=array['photos']::text[] and r.approved_max_budget=0 and r.currency='USD' and r.status='draft'
), known_verification_plans as (
 select p.* from public.verification_plans p join known_verification_requests r on r.id=p.verification_request_id
 join fixture_ids f on f.request=r.id and f.plan=p.id
 where p.provider_model='synthetic-fixture-not-SERV' and p.provenance='serv_server_v1' and p.generated_by=r.created_by
 and p.version=1 and p.duration_ms=0 and p.request_fingerprint=r.request_fingerprint
 and p.structured_plan->>'summary'='Synthetic isolated rehearsal; not a SERV response.'
 and p.receipt_signature=repeat('ef',32)
), known_task_assignments as (
 select a.* from public.task_assignments a join known_verification_requests r on r.id=a.verification_request_id
 join known_verification_plans p on p.id=a.plan_id and p.verification_request_id=r.id
 join dedicated d on d.id=a.verifier_id and d.label='c'
 where a.assigned_by=r.created_by and exists(select 1 from known_workspace_members m
  where m.workspace_id=r.workspace_id and m.user_id=a.verifier_id and m.role='verifier')
), known_task_evidence as (
 select e.* from public.task_evidence e join known_task_assignments a on a.id=e.assignment_id
 where e.verifier_id=a.verifier_id and e.file_path=a.id::text||'/'||e.id::text
 and ((e.observation='Synthetic isolated Storage test; not real field evidence.'
  and e.mime_type='image/png' and e.location is null and e.submission_round=1)
 or (/*BROWSER_EVIDENCE*/false and a.verification_request_id='SP-36000000-0000-4000-8000-000000000003'
  and e.mime_type in ('image/png','image/jpeg','image/webp')))
), known_assignment_events as (
 select ev.* from public.assignment_events ev join known_task_assignments a on a.id=ev.assignment_id
 where (ev.note='' or (/*BROWSER_EVIDENCE*/false and a.verification_request_id='SP-36000000-0000-4000-8000-000000000003'))
 and ((ev.action in ('assigned','approve','revise','complete') and ev.actor_id=a.assigned_by)
 or (ev.action in ('accept','decline','submitted') and ev.actor_id=a.verifier_id))
 and (ev.evidence_id is null or exists(select 1 from known_task_evidence e where e.id=ev.evidence_id and e.assignment_id=a.id))
), known_task_events as (
 select t.* from public.task_events t where false
)`;

export const fixtureCountsSQL = `${fixtureCTE}
${fixtureTables.map(table => `select '${table}' as table_name,
 (select count(*)::int from public.${table}) as total,
 (select count(*)::int from known_${table}) as known,
 (select coalesce(jsonb_agg(label order by label),'[]'::jsonb) from (
  select ${table === "workspace_members" ? "k.workspace_id::text||':'||k.role||':pilot-'||d.label" : "k.id::text"} as label
  from known_${table} k ${table === "workspace_members" ? "join dedicated d on d.id=k.user_id" : ""}
  order by label) labels) as ids`).join("\nunion all\n")}`;

export const objectChecks = ["uuid_path", "unique_reservation", "reservation_path", "assignment_prefix", "evidence_suffix", "synthetic_chain", "uploader", "mime", "bytes", "creation_window"];
export const browserCompletionSQL = `${fixtureCTE}
select exists(select 1 from known_task_assignments a join known_task_evidence e on e.assignment_id=a.id
 join known_verification_requests r on r.id=a.verification_request_id
 where r.id='SP-36000000-0000-4000-8000-000000000003' and a.status='completed'
 and e.submitted_at is not null and e.sha256 ~ '^[a-f0-9]{64}$'
 and exists(select 1 from storage.objects o where o.bucket_id='verification-evidence' and o.name=e.file_path
  and o.owner_id=e.verifier_id::text and o.metadata->>'size'=e.byte_size::text and o.metadata->>'mimetype'=e.mime_type)
 and exists(select 1 from known_assignment_events ev where ev.assignment_id=a.id and ev.action='assigned' and ev.actor_id=a.assigned_by)
 and exists(select 1 from known_assignment_events ev where ev.assignment_id=a.id and ev.action='accept' and ev.actor_id=a.verifier_id)
 and exists(select 1 from known_assignment_events ev where ev.assignment_id=a.id and ev.action='submitted' and ev.evidence_id=e.id and ev.actor_id=a.verifier_id)
 and exists(select 1 from known_assignment_events ev where ev.assignment_id=a.id and ev.action='approve' and ev.evidence_id=e.id and ev.actor_id=a.assigned_by)
 and exists(select 1 from known_assignment_events ev where ev.assignment_id=a.id and ev.action='complete' and ev.evidence_id=e.id and ev.actor_id=a.assigned_by)
) as browser_complete`;
export const storageObjectsSQL = `${fixtureCTE}
select o.name,
 o.id::text as catalog_id,o.owner_id as catalog_owner,to_jsonb(o)->>'owner' as catalog_legacy_owner,
 o.metadata->>'size' as catalog_size,o.metadata->>'mimetype' as catalog_mime,
 o.metadata->>'contentLength' as catalog_content_length,o.metadata->>'contentType' as catalog_content_type,
 to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as catalog_created_at,
 to_char(o.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as catalog_updated_at,
 e.id::text as evidence_id,e.assignment_id::text as assignment_id,e.file_path as expected_path,
 r.id as request_id,a.plan_id::text as plan_id,e.verifier_id::text as verifier_id,
 e.byte_size as reserved_size,e.mime_type as reserved_mime,
 to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as reservation_created_at,
 to_char(r.expiration at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as request_expires_at,
 o.name ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' as uuid_path,
 coalesce(e.candidate_count=1,false) as unique_reservation,
 coalesce(e.file_path=o.name,false) as reservation_path,
 coalesce(e.assignment_id::text=split_part(o.name,'/',1),false) as assignment_prefix,
 coalesce(e.id::text=split_part(o.name,'/',2),false) as evidence_suffix,
 exists(select 1 from known_task_evidence k where k.id=e.id) as synthetic_chain,
 coalesce(o.owner_id=e.verifier_id::text,false) as uploader,
 coalesce(o.metadata->>'mimetype'=e.mime_type,false) as mime,
 coalesce(o.metadata->>'size'=e.byte_size::text,false) as bytes,
 coalesce(o.created_at>=e.created_at and e.created_at>=r.created_at and o.created_at<=r.expiration,false) as creation_window
from storage.objects o
left join lateral (
 select candidates.*,count(*) over(partition by match_rank) as candidate_count from (
  select x.*,case when x.file_path=o.name then 0
   when x.id::text=regexp_replace(o.name,'^.*/','') then 1 else 2 end as match_rank
  from public.task_evidence x where x.file_path=o.name
   or x.id::text=regexp_replace(o.name,'^.*/','') or x.assignment_id::text=split_part(o.name,'/',1)
 ) candidates order by match_rank,id limit 1
) e on true
left join public.task_assignments a on a.id=e.assignment_id
left join public.verification_requests r on r.id=a.verification_request_id
where o.bucket_id='verification-evidence' order by o.name`;

export function validateFixtureCounts(result) {
  completion(result, "SELECT");
  check(result.rows?.length === fixtureTables.length);
  const rows = fixtureTables.map(table => {
    const matching = result.rows.filter(row => row.table_name === table);
    check(matching.length === 1);
    const row = matching[0];
    check(Number.isSafeInteger(row.total) && Number.isSafeInteger(row.known) && row.total >= row.known && row.known >= 0 && Array.isArray(row.ids));
    check(row.ids.every(id => typeof id === "string" && /^(?:SP-)?[a-f0-9-]{36}(?::(?:dispatcher|verifier):pilot-[abc])?$/.test(id)));
    return { ...row, unknown: row.total - row.known };
  });
  return rows;
}
export function verifiedSyntheticObject(row) {
  return objectChecks.every(key => row[key] === true) && typeof row.name === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.name);
}
export function storageFixtureQuery(sql, { browser = false } = {}) {
  return sql.replaceAll("/*BROWSER_EVIDENCE*/false", browser === true ? "true" : "false");
}
export async function readFixtureCounts(client, options) {
  return validateFixtureCounts(await client.query(storageFixtureQuery(fixtureCountsSQL, options)));
}
export function requireOnlyKnownFixtures(rows) {
  check(rows.every(row => row.unknown === 0));
}
export function cleanupErrorCategory(error) {
  const categories = {
    "42501": "PERMISSION_DENIED", "23503": "FOREIGN_KEY_CONSTRAINT", "23505": "UNIQUE_CONSTRAINT",
    "40001": "SERIALIZATION_RETRY_REQUIRED", "40P01": "DEADLOCK", P0001: "SQL_GUARD_REFUSED",
    "42P01": "MISSING_TABLE", "42703": "MISSING_COLUMN", "42601": "SQL_SYNTAX",
  };
  return Object.hasOwn(categories, error?.code ?? "")
    ? `sqlstate=${error.code}; category=${categories[error.code]}` : "sqlstate=UNAVAILABLE; category=CHECK_OR_CONNECTION_ERROR";
}
