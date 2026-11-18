-- Owner-only READ-ONLY inspection; never select keys, signatures or plan contents.
-- IDs are ordinary private test record references, not credentials.
-- Gate state does not establish authorization or real Storage API behavior.
with accepted as (
 select r.id as request_id,p.id as plan_id,r.workspace_id,
  p.provenance,p.accepted_at,r.expiration,r.approved_max_budget,
  p.generated_by=r.created_by as creator_bound,
  p.version=1 as supported_version,
  p.request_fingerprint=r.request_fingerprint as fingerprint_matches,
  p.receipt_signature ~ '^[0-9a-f]{64}$' as receipt_recorded,
  r.status='draft' as request_remains_draft,
  r.expiration>now() as unexpired,
  not ('video'=any(r.evidence_requirements)) as evidence_supported,
  (r.request_fingerprint::jsonb->>9)::numeric=r.approved_max_budget as budget_matches_signed_snapshot,
  exists(select 1 from public.workspace_members m where m.workspace_id=r.workspace_id and m.user_id=r.created_by and m.role='dispatcher') as creator_is_dispatcher,
  (select count(*) from public.workspace_members m where m.workspace_id=r.workspace_id and m.role='dispatcher') as workspace_dispatchers,
  (select count(*) from public.workspace_members m where m.workspace_id=r.workspace_id and m.role='verifier') as workspace_verifiers,
  (select count(*) from public.workspace_members m where m.workspace_id=r.workspace_id and m.role='verifier' and m.user_id<>r.created_by) as assignable_verifiers,
  exists(select 1 from public.task_assignments a where a.verification_request_id=r.id) as already_assigned
 from public.verification_requests r join public.verification_plans p on p.verification_request_id=r.id
 where p.accepted_at is not null
)
select jsonb_build_object(
 'gate',(select jsonb_build_object('enabled',enabled,'live_checks_verified',live_checks_verified) from spotly_private.workflow_gate where singleton),
 'approved_verifier_memberships',(select count(*) from public.workspace_members where role='verifier'),
 'verifier_enabled_workspaces',(select count(distinct workspace_id) from public.workspace_members where role='verifier'),
 'approved_verifier_workspaces',(select coalesce(jsonb_agg(distinct workspace_id),'[]'::jsonb) from public.workspace_members where role='verifier'),
 'accepted_plans',coalesce((select jsonb_agg(to_jsonb(accepted)) from accepted),'[]'::jsonb),
 'workflow_totals',jsonb_build_object('assignments',(select count(*) from public.task_assignments),
  'evidence',(select count(*) from public.task_evidence)),
 'budget_writes_denied',not has_table_privilege('authenticated','public.verification_requests','UPDATE')
  and not has_column_privilege('authenticated','public.verification_requests','approved_max_budget','UPDATE')
) as assignment_readiness;
