# Private Storage download incident · November 18, 2026

Status: unresolved, release blocker. Prepared for private Supabase support; **not submitted**. No hosted logs or privileged control have been executed by the agent. Do not describe this as a confirmed infrastructure defect yet.

## Established observations

The owner reports that disposable project `ogqmifuylakjhwveqrmd` accepts C's real PNG upload. The exact catalog object and owner match; Auth verifies the unexpired C JWT actually used for download. Independently replayed SQL permits C and both deployed SELECT policies evaluate true. The download returns HTTP 400 with wire `code=NoSuchKey`, `error=not_found` and service status 404. This report accepts those checks; repeating filename, bucket, token or generic SQL-policy investigations is not the next task.

The owner subsequently supplied the captured `sb-request-id` and an approximate UTC time derived from its UUIDv7 timestamp. The timestamp is not independently log-verified. Exact correlation data is retained only in the ignored local `.spotly-security-download-query.sql`, excluded from the release. The recovery journal contains fixture provenance, not an HTTP request log. Never replace an absent historical object with a new row. No hosted logs have yet been read: the installed CLI lacks a hosted logs command, no browser is connected, and the available Supabase integration is not connected.

Application `app/api/evidence/route.ts` uses the same authenticated client to reserve, upload without overwrite and download the returned path before signing submission. `app/api/evidence/[id]/route.ts` serves only submitted evidence after another authenticated read and digest check. The installed SDK uses `GET /storage/v1/object/verification-evidence/<path>` without an image transformation. Local SDK tests verify this with mocked HTTP, not the hosted service.

Current upstream Storage resolves the catalog object under RLS, then renders the backing key **with the object's version**. Thus independent SQL and catalog presence alone cannot distinguish service-context denial from backing retrieval failure. The `/object/` and `/object/authenticated/` routes share that handler and operation; an alternate URL is not a justified fix. The hosted revision must be checked by Supabase. [Route source](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObject.ts), [backend renderer](https://github.com/supabase/storage/blob/master/src/storage/renderer/asset.ts).

## Smallest next diagnostic: existing failed request, no writes

In the disposable project's Dashboard, select Logs → Explorer → Run SQL → **Logs**, select the incident's UTC time range, then run this ClickHouse query with the previously captured UUID substituted. This is not PostgreSQL/SQL Editor syntax. Supabase documents `request_id` and Storage `reqId`; fields may be absent. [Log fields](https://supabase.com/docs/guides/observability/log-field-reference), [Storage logs](https://supabase.com/docs/guides/storage/debugging/logs).

```sql
select timestamp, source, id,
       log_attributes['request_id'] as request_id,
       log_attributes['reqId'] as storage_request_id,
       log_attributes['req.method'] as method,
       log_attributes['res.statusCode'] as storage_status,
       log_attributes['response.headers.cf_cache_status'] as gateway_cache_status
from logs
where source in ('storage_logs', 'edge_logs')
  and (log_attributes['request_id'] = 'REPLACE_WITH_CAPTURED_UUID'
       or log_attributes['reqId'] = 'REPLACE_WITH_CAPTURED_UUID')
order by timestamp asc
limit 30;
```

Open only the matched Storage event privately and inspect its backend cause/stack with support. Do not export entire log attributes, Authorization headers, signed URLs or raw error dumps into source/chat. If the UUID is unavailable, filter the same narrow time range to Storage `req.method='GET'`, the exact known `req.url` and status 400 in the private console; correlate that event's IDs. No matching event proves nothing: retention, missing fields and gateway routing can prevent a match. Escalate with the original time/response ID; do not rerun a write fixture merely to obtain new diagnostics.

Ask support to identify which branch actually failed for that ID:

| Result | Decisive service-side evidence | Action |
| --- | --- | --- |
| A: backing bytes unavailable | Catalog lookup succeeded; backend GetObject for the resolved locator/version returned missing object, with backend request ID. | Supabase investigates storage persistence; no finalize-first workaround. |
| B: internal auth context differs | Catalog lookup returned no visible object; service's effective DB role/subject, operation context or applicable policy differs from the verified independent replay. | Fix only the specifically demonstrated service/app context defect. Do not relax policies. |
| C: wrong backend location/version | Service resolved a tenant/key/version different from the successful upload's committed locator/version, or used a stale version/cache mapping. | Supabase reconciles locator/version and caches; do not mutate catalog metadata manually. |
| D: other service defect | Concrete gateway, tenant routing, database or Storage exception linked to the request, outside A–C. | Apply the confirmed narrowly scoped fix or escalate to its owner. |

A generic `NoSuchKey`, missing log entry or unprivileged SQL replay is insufficient to choose a branch. Historical objects have been deleted: a current privileged GET of their paths would be expected to fail and cannot diagnose the old incident.

If support needs a trusted read control on a surviving **disposable** object, ask them to perform one authenticated admin read of the same path/version and compare its bytes with the upload digest, paired with a contemporaneous C request. Admin success narrows B/service-context but does not by itself prove which setting differs; admin failure requires the backend trace to distinguish A from C. Keep any admin credential exclusively in a separate terminal/server diagnostic for the fixed test project, never an application route, browser environment or committed file. Do not create signed URLs or change RLS/bucket privacy for this control. New uploads/gate activation require a separate reviewed owner-run fixture after recovery; no such remote writes are authorized for automatic execution here.

## Support ticket body

**Subject:** Private Storage GET returns NoSuchKey after successful upload and independently permitted SQL read

**Project:** disposable `ogqmifuylakjhwveqrmd`; production excluded.

**Impact:** Spotly cannot verify stored photographic bytes before evidence finalization. Submissions fail closed, preventing dispatcher review/completion. No bypass is deployed.

**Correlation:** failed GET `sb-request-id`: [fill privately from existing capture]; UTC time: [fill]; successful POST request ID/time: [if retained]; exact catalog ID/path/version and upload digest: [provide privately if requested]. No credentials/JWTs are attached. SDK versions are recorded in the release lockfile.

**Observed:** one ordinary non-overwrite PNG POST succeeds and exact object catalog/owner is confirmed. The following same-session GET returns actual HTTP 400, body service status 404, code NoSuchKey and error not_found. Auth verifies C's exact current token. Independent authenticated SQL sees the row and both complete deployed SELECT predicates pass. B/anonymous denials are separate controls, not proof of C's internal service context.

**Request:** correlate the existing GET and POST IDs with the hosted Storage revision and service traces. Did the GET fail at RLS catalog lookup or backend GetObject? Compare its effective DB role/subject/operation with C's verified replay. If lookup succeeded, compare the resolved tenant/backend key/version with the upload's committed locator/version and identify the backing-store response/request ID. Please distinguish A/B/C/D above and advise a confirmed fix. Do not delete metadata, weaken RLS, make the bucket public or modify production data.

**Cleanup:** owner reports zero Storage objects, both test gates closed and temporary scope/key removed. Synthetic database fixture deletion is pending guarded recovery; the original journal is retained. Historical absence now is expected and does not refute the earlier failure.
