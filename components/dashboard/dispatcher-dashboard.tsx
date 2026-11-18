"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useVerifications } from "@/lib/use-verifications";
import {
  filterVerifications,
  verificationStats,
  requestedLabel,
} from "@/lib/verification-selectors";
import { StorageNotice } from "@/components/verifications/storage-notice";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCheck,
  Clock3,
  FileCheck2,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusBadge } from "@/components/ui/status-badge";
import { MapPreview } from "./map-preview";
import { ImportLocalDrafts } from "@/components/verifications/import-local-drafts";
import { demoVerifications } from "@/lib/demo-data";

export function DispatcherDashboard({ view = "Overview" }: { view?: string }) {
  const router = useRouter();
  function setView(next: string) {
    router.replace(
      next === "Overview"
        ? "/dispatcher"
        : `/dispatcher?view=${encodeURIComponent(next)}`,
      { scroll: false },
    );
  }
  const { tasks: requests, ready, issue, retry } = useVerifications();
  const [filter, setFilter] = useState("All requests");
  const [selectedSample, setSelectedSample] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [notifications, setNotifications] = useState(false);
  const filtered = filterVerifications(requests, filter, search);
  const counts = verificationStats(requests);
  const stats = [
    {
      label: "Active verifications",
      value: String(counts.active).padStart(2, "0"),
      icon: Activity,
      caption: "Drafts are not active field work",
      tone: "green",
    },
    {
      label: "Awaiting review",
      value: String(counts.awaitingReview).padStart(2, "0"),
      icon: FileCheck2,
      caption: "Ready for your attention",
      tone: "amber",
    },
    {
      label: "Completed",
      value: String(counts.completed).padStart(2, "0"),
      icon: CheckCheck,
      caption: "Verified workspace completions",
      tone: "green",
    },
    {
      label: "Verification spending",
      value: `$${counts.sampleSpending.toFixed(2)}`,
      icon: Wallet,
      caption: "USD · no payments enabled",
      tone: "neutral",
    },
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar view={view} onView={setView} count={requests.length} />
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{view}</strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-pill">
              <span /> Your account
            </span>
            <div className="notification-wrap">
              <button
                className="icon-button notification-button"
                aria-label="Notifications"
                aria-expanded={notifications}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={19} />
                <i />
              </button>
              {notifications && (
                <div className="notification-panel">
                  <strong>You’re up to date</strong>
                  <p>
                    No live notifications are connected in this phase.
                  </p>
                </div>
              )}
            </div>
            <span className="avatar small">S</span>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> YOUR OPERATIONS, IN VIEW
              </div>
              <h1>
                {view === "Overview"
                  ? "Operations overview"
                  : view === "Map"
                    ? "Location overview"
                    : "Your verifications."}
              </h1>
              <p>
                Know what’s happening on the ground. Make your next move with
                confidence.
              </p>
            </div>
            <Link
              className="button primary"
              href="/dispatcher/verifications/new"
            >
              <Plus size={18} /> New verification
            </Link>
          </div>
          <ImportLocalDrafts />
          <div className="demo-banner">
            <span>
              <ShieldCheck size={16} />
              <strong>Dispatcher workspace</strong>
              <span>
                {" "}
                Your workspace requests are saved to Supabase. Drafts are not
                assigned.
              </span>
            </span>
            <span className="phase-tag">PHASE 3A</span>
          </div>
          <StorageNotice issue={issue} retry={retry} />
          {!ready && (
            <p role="status" className="workspace-loading">
              Loading workspace requests…
            </p>
          )}
          {ready && counts.drafts > 0 && (
            <div className="draft-count-note">
              <span className="local-data-tag">
                {counts.drafts} saved {counts.drafts === 1 ? "draft" : "drafts"}
              </span>
              Not included in active verifications, completed work, or spending.
            </div>
          )}
          {view === "Overview" && (
            <section className="stats-grid" aria-label="Verification overview">
              {stats.map(({ label, value, icon: Icon, caption, tone }) => (
                <article className="card stat-card" key={label}>
                  <div className="stat-top">
                    <span>{label}</span>
                    <span className={`stat-icon ${tone}`}>
                      <Icon size={18} />
                    </span>
                  </div>
                  <strong className="stat-value">{value}</strong>
                  <p>
                    {label === "Awaiting review" ? (
                      <span className="tiny-amber" />
                    ) : label === "Completed" ? (
                      <ArrowUpRight size={14} />
                    ) : null}
                    {caption}
                  </p>
                </article>
              ))}
            </section>
          )}
          {view !== "Verifications" && (
            <div className="overview-grid">
              <MapPreview
                onSelect={(index) => { setSelectedSample(index); }}
              />
              {selectedSample !== null && <section className="card form-card"><h2>Illustrative sample</h2><p>{demoVerifications[selectedSample].title}</p><p>{demoVerifications[selectedSample].question}</p><p>Bundled example only. This is not workspace activity.</p><button className="button secondary" onClick={() => setSelectedSample(null)}>Close sample</button></section>}
              <section className="card workflow-card">
                <span className="workflow-icon">
                  <ShieldCheck size={25} />
                </span>
                <span className="eyebrow">THE VERIFICATION WORKFLOW</span>
                <h2>
                  From request
                  <br />
                  to resolution.
                </h2>
                <p>The intended journey for every ground check.</p>
                <ol>
                  <li>
                    <span>1</span>
                    <div>
                      <strong>Ask for a ground check</strong>
                      <p>Tell us what you need to know.</p>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Get a fresh perspective</strong>
                      <p>A field verifier gathers evidence.</p>
                    </div>
                  </li>
                  <li>
                    <span>3</span>
                    <div>
                      <strong>Make an informed move</strong>
                      <p>Review the report and take action.</p>
                    </div>
                  </li>
                </ol>
                <div className="workflow-note">
                  <ArrowDownLeft size={16} />
                  The workflow above is a preview.
                  <br />
                  Live verification is coming later.
                </div>
              </section>
            </div>
          )}
          {view !== "Map" && (
            <section
              className="card requests-card"
              aria-labelledby="requests-title"
            >
              <div className="card-heading">
                <div className="request-heading">
                  <h2 id="requests-title">
                    {view === "Verifications"
                      ? "All verifications"
                      : "Recent verifications"}
                  </h2>
                  <span className="count-badge">{requests.length}</span>
                  <span className="data-label">Workspace requests</span>
                </div>
                {view === "Overview" && (
                  <button
                    className="text-button"
                    onClick={() => setView("Verifications")}
                  >
                    View all requests <ArrowRight size={15} />
                  </button>
                )}
              </div>
              <div className="table-toolbar">
                <div className="tabs" aria-label="Filter requests">
                  {[
                    "All requests",
                    "draft",
                    "In progress",
                    "Awaiting review",
                    "Completed",
                    "Planning",
                  ].map((status) => (
                    <button
                      key={status}
                      aria-pressed={filter === status}
                      className={filter === status ? "selected" : ""}
                      onClick={() => setFilter(status)}
                    >
                      {status === "draft" ? "Drafts" : status}
                    </button>
                  ))}
                </div>
                <label className="search-box">
                  <Search size={16} />
                  <span className="sr-only">Search requests</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search requests…"
                  />
                </label>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>VERIFICATION REQUEST</th>
                      <th>STATUS</th>
                      <th>REQUESTED</th>
                      <th>MAX BUDGET · USD</th>
                      <th>
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((request) => (
                      <tr key={request.id}>
                        <td>
                          <div className="request-cell">
                            <span className="location-icon">
                              <MapPin size={19} />
                            </span>
                            <div>
                              <Link
                                className="request-title"
                                href={`/dispatcher/verifications/${request.id}`}
                              >
                                {request.title}
                              </Link>
                              <span className="request-location">
                                <span title={request.id}>
                                  {request.source !== "sample"
                                    ? `${request.id.slice(0, 11)}…`
                                    : request.id}
                                </span>
                                <span>·</span>
                                {request.locationDescription}
                              </span>
                              <span
                                className={`request-source ${request.source !== "sample" ? "local-source" : ""}`}
                              >
                                {request.source !== "sample"
                                  ? "Saved draft · unassigned"
                                  : "Sample data"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={request.status} />
                        </td>
                        <td className="muted">
                          <Clock3 size={13} />
                          {requestedLabel(request)}
                        </td>
                        <td>${request.budget.toFixed(2)}</td>
                        <td>
                          <Link
                            className="icon-button"
                            href={`/dispatcher/verifications/${request.id}`}
                            aria-label={`View ${request.title}`}
                          >
                            <ArrowUpRight size={18} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && (
                <div className="empty-state">
                  <Search size={27} />
                  <h3>No requests found</h3>
                  <p>
                    Try another search or clear the filters to see your workspace
                    requests.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setFilter("All requests");
                      setSearch("");
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              )}
              <div className="table-footer">
                <span>
                  Showing {filtered.length} of {requests.length} requests
                </span>
                <span>
                  <span className="legend-dot" />
                  Times use your device’s timezone
                </span>
              </div>
            </section>
          )}
          <footer className="page-footer">
            <span className="footer-brand">
              <MapPin size={15} /> Spotly{" "}
              <span>Know what’s happening, anywhere.</span>
            </span>
            <span>
              Built for SERV Hackathon 02 <span className="footer-dot">·</span>{" "}
              Phase 3A
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
