"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { VerificationShell } from "@/components/layout/verification-shell";
import { LocationMap } from "@/components/maps/location-map";
import { RequestSummary } from "./request-summary";
import { StorageNotice } from "./storage-notice";
import { createVerification, useVerifications } from "@/lib/use-verifications";
import {
  coordinatesSchema,
  categoryLabels,
  evidenceLabels,
  validateNewVerification,
} from "@/lib/validation/verification";
import type {
  Coordinates,
  EvidenceRequirement,
  VerificationInput,
} from "@/types/verification";

type FormValues = {
  title: string;
  question: string;
  category: string;
  locationDescription: string;
  latitude: string;
  longitude: string;
  evidenceRequirements: EvidenceRequirement[];
  expiration: string;
  budget: string;
};
const empty: FormValues = {
  title: "",
  question: "",
  category: "",
  locationDescription: "",
  latitude: "",
  longitude: "",
  evidenceRequirements: [],
  expiration: "",
  budget: "",
};
function numeric(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

export function CreateVerification() {
  const router = useRouter();
  const store = useVerifications();
  const [form, setForm] = useState<FormValues>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState<VerificationInput | null>(null);
  const [approved, setApproved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const submitLock = useRef(false);
  const errorSummary = useRef<HTMLDivElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  function update<Key extends keyof FormValues>(
    key: Key,
    value: FormValues[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  const pointResult = coordinatesSchema.safeParse({
    latitude: numeric(form.latitude),
    longitude: numeric(form.longitude),
  });
  const point = pointResult.success ? pointResult.data : null;
  function chooseLocation(coordinates: Coordinates) {
    setForm((current) => ({
      ...current,
      latitude: coordinates.latitude.toFixed(6),
      longitude: coordinates.longitude.toFixed(6),
    }));
  }
  function prepareReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const expiration = form.expiration ? new Date(form.expiration) : null;
    const result = validateNewVerification({
      title: form.title,
      question: form.question,
      category: form.category,
      locationDescription: form.locationDescription,
      coordinates: {
        latitude: numeric(form.latitude),
        longitude: numeric(form.longitude),
      },
      evidenceRequirements: form.evidenceRequirements,
      expiresAt:
        expiration && Number.isFinite(expiration.getTime())
          ? expiration.toISOString()
          : "",
      budget: numeric(form.budget),
    });
    if (!result.success) {
      const next: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join(".");
        next[key] ??= issue.message;
      }
      setErrors(next);
      setTimeout(() => errorSummary.current?.focus(), 0);
      return;
    }
    setErrors({});
    setSaveError("");
    setApproved(false);
    setReview(result.data);
    setTimeout(() => {
      reviewHeading.current?.focus();
      reviewHeading.current?.scrollIntoView({ block: "start" });
    }, 0);
  }
  async function save() {
    if (!review || !approved || submitLock.current) return;
    submitLock.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const task = await createVerification(review);
      router.push(`/dispatcher/verifications/${task.id}`);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "The request was not saved. Please retry.",
      );
      submitLock.current = false;
      setSaving(false);
    }
  }
  function error(key: string) {
    return errors[key] ? (
      <span className="field-error" id={`${key}-error`}>
        {errors[key]}
      </span>
    ) : null;
  }
  function accessibility(key: string) {
    return {
      "aria-invalid": Boolean(errors[key]),
      "aria-describedby": errors[key] ? `${key}-error` : undefined,
    };
  }
  return (
    <VerificationShell label="New verification">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A FRESH QUESTION. A SPECIFIC PLACE.</span>
          <h1>New verification</h1>
          <p>
            Define a ground check, select a location, and set the budget you
            approve.
          </p>
        </div>
        <span className="local-data-tag">
          <ShieldCheck size={14} />
          Saved to your workspace
        </span>
      </div>
      <StorageNotice issue={store.issue} retry={store.retry} />
      <ol className="creation-progress" aria-label="Request creation steps">
        <li className="current">
          <span>{review ? <Check size={13} /> : "1"}</span>Request details
        </li>
        <li className={review ? "current" : ""}>
          <span>2</span>Review & create
        </li>
      </ol>
      {review ? (
        <div className="creation-grid">
          <section className="card review-card">
            <div className="form-section-heading">
              <span className="form-section-icon">
                <ClipboardList size={21} />
              </span>
              <div>
                <h2 ref={reviewHeading} tabIndex={-1}>
                  Review your request
                </h2>
                <p>Confirm the details and your maximum budget.</p>
              </div>
            </div>
            <RequestSummary request={review} />
            <div className="review-approval">
              <label>
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(event) => setApproved(event.target.checked)}
                  disabled={saving}
                />
                <span>
                  I approve a maximum budget of{" "}
                  <strong>${review.budget.toFixed(2)} USD</strong> for this
                  request. I understand this creates an unassigned saved draft
                  and makes no payment.
                </span>
              </label>
            </div>
            {saveError && (
              <p role="alert" className="save-error">
                {saveError}
              </p>
            )}
            <div className="creation-actions">
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={() => {
                  setReview(null);
                  setApproved(false);
                  setSaveError("");
                }}
              >
                <ArrowLeft size={15} />
                Edit request
              </button>
              <button
                type="button"
                className="button primary"
                disabled={
                  !approved || saving || !store.ready || Boolean(store.issue)
                }
                onClick={save}
              >
                {saving ? "Saving draft…" : "Create verification draft"}
                <Check size={16} />
              </button>
            </div>
          </section>
          <aside className="creation-aside">
            <section className="card">
              <div className="card-heading">
                <div>
                  <h2>Selected location</h2>
                  <p>Coordinates supplied by you.</p>
                </div>
                <MapPin size={18} />
              </div>
              <LocationMap value={review.coordinates} />
              <div className="selected-coordinates">
                {review.coordinates.latitude.toFixed(6)},{" "}
                {review.coordinates.longitude.toFixed(6)}
              </div>
            </section>
            <div className="draft-note">
              <ShieldCheck size={20} />
              <div>
                <h3>You stay in control.</h3>
                <p>
                  Creating a draft does not dispatch a verifier, start an AI
                  agent, or authorize a payment.
                </p>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <form className="creation-grid" onSubmit={prepareReview} noValidate>
          <div className="creation-form">
            <section className="card form-card">
              <div className="form-section-heading">
                <span className="form-section-icon">
                  <ClipboardList size={21} />
                </span>
                <div>
                  <h2>What needs verifying?</h2>
                  <p>Give the request a clear focus.</p>
                </div>
              </div>
              {Object.keys(errors).length > 0 && (
                <div
                  role="alert"
                  className="validation-summary"
                  tabIndex={-1}
                  ref={errorSummary}
                >
                  <strong>Please check the highlighted fields.</strong>
                  <ul>
                    {Object.entries(errors).map(([key, message]) => (
                      <li key={key}>
                        <a
                          href={`#${key === "expiresAt" ? "expiration" : key === "evidenceRequirements" ? "evidence-photos" : key}`}
                        >
                          {message}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <label className="form-field" htmlFor="title">
                Verification title <span>Required</span>
                <input
                  id="title"
                  value={form.title}
                  maxLength={100}
                  placeholder="e.g. Lagos–Ibadan road check"
                  onChange={(event) => update("title", event.target.value)}
                  required
                  {...accessibility("title")}
                />
                {error("title")}
              </label>
              <label className="form-field" htmlFor="question">
                Verification question <span>Required</span>
                <textarea
                  id="question"
                  value={form.question}
                  maxLength={2000}
                  rows={4}
                  placeholder="What specific question should the field evidence answer?"
                  onChange={(event) => update("question", event.target.value)}
                  required
                  {...accessibility("question")}
                />
                {error("question")}
              </label>
              <label className="form-field" htmlFor="category">
                Verification category <span>Required</span>
                <select
                  id="category"
                  value={form.category}
                  onChange={(event) => update("category", event.target.value)}
                  required
                  {...accessibility("category")}
                >
                  <option value="">Choose a category</option>
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {error("category")}
              </label>
            </section>
            <section className="card form-card">
              <div className="form-section-heading">
                <span className="form-section-icon">
                  <MapPin size={21} />
                </span>
                <div>
                  <h2>Where should we look?</h2>
                  <p>Select a point on the map or enter coordinates.</p>
                </div>
              </div>
              <label className="form-field" htmlFor="locationDescription">
                Location description <span>Required</span>
                <textarea
                  id="locationDescription"
                  value={form.locationDescription}
                  maxLength={300}
                  rows={2}
                  placeholder="Describe the road, landmark, or access point."
                  onChange={(event) =>
                    update("locationDescription", event.target.value)
                  }
                  required
                  {...accessibility("locationDescription")}
                />
                {error("locationDescription")}
              </label>
              <a className="select-on-map" href="#request-location-map">
                Select coordinates on the map <MapPin size={13} />
              </a>
              <div className="coordinate-fields">
                <label className="form-field" htmlFor="coordinates.latitude">
                  Latitude <span>−90 to 90</span>
                  <input
                    id="coordinates.latitude"
                    type="number"
                    step="any"
                    min="-90"
                    max="90"
                    value={form.latitude}
                    placeholder="6.524400"
                    onChange={(event) => update("latitude", event.target.value)}
                    required
                    {...accessibility("coordinates.latitude")}
                  />
                  {error("coordinates.latitude")}
                </label>
                <label className="form-field" htmlFor="coordinates.longitude">
                  Longitude <span>−180 to 180</span>
                  <input
                    id="coordinates.longitude"
                    type="number"
                    step="any"
                    min="-180"
                    max="180"
                    value={form.longitude}
                    placeholder="3.379200"
                    onChange={(event) =>
                      update("longitude", event.target.value)
                    }
                    required
                    {...accessibility("coordinates.longitude")}
                  />
                  {error("coordinates.longitude")}
                </label>
              </div>
              <p className="field-hint">
                Coordinates identify a point, not a verified address. Your own
                description is stored without an address lookup.
              </p>
            </section>
            <section className="card form-card">
              <div className="form-section-heading">
                <span className="form-section-icon">
                  <ShieldCheck size={21} />
                </span>
                <div>
                  <h2>Evidence & limits</h2>
                  <p>Set expectations before a request moves forward.</p>
                </div>
              </div>
              <fieldset
                className="evidence-fieldset"
                {...accessibility("evidenceRequirements")}
              >
                <legend>
                  Required evidence <span>Choose at least one</span>
                </legend>
                {Object.entries(evidenceLabels).map(([key, label]) => (
                  <label key={key} className="evidence-option">
                    <input
                      id={`evidence-${key}`}
                      type="checkbox"
                      checked={form.evidenceRequirements.includes(
                        key as EvidenceRequirement,
                      )}
                      onChange={(event) =>
                        update(
                          "evidenceRequirements",
                          event.target.checked
                            ? [
                                ...form.evidenceRequirements,
                                key as EvidenceRequirement,
                              ]
                            : form.evidenceRequirements.filter(
                                (item) => item !== key,
                              ),
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
                {error("evidenceRequirements")}
              </fieldset>
              <label className="form-field" htmlFor="expiration">
                Expiration date & time <span>Required</span>
                <input
                  id="expiration"
                  type="datetime-local"
                  value={form.expiration}
                  onChange={(event) => update("expiration", event.target.value)}
                  required
                  {...accessibility("expiresAt")}
                />
                {error("expiresAt")}
                <small className="field-hint">
                  Enter a future date and time in your device’s local timezone.
                </small>
              </label>
              <label className="form-field" htmlFor="budget">
                Maximum payment budget (USD) <span>Required · set by you</span>
                <input
                  id="budget"
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  value={form.budget}
                  onChange={(event) => update("budget", event.target.value)}
                  placeholder="Enter amount, e.g. 25.00"
                  required
                  {...accessibility("budget")}
                />
                {error("budget")}
                <small className="field-hint">
                  No default budget. Enter the maximum you approve, including $0
                  if applicable. Demo only; no funds move.
                </small>
              </label>
            </section>
            <div className="creation-actions">
              <Link href="/dispatcher" className="button secondary">
                Cancel
              </Link>
              <button
                type="submit"
                className="button primary"
                disabled={!store.ready || Boolean(store.issue)}
              >
                Review request
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <aside className="creation-aside">
            <section
              className="card creation-map-card"
              id="request-location-map"
            >
              <div className="card-heading">
                <div>
                  <h2>Select a location</h2>
                  <p>Click to place a pin. Drag to reposition.</p>
                </div>
                <MapPin size={18} />
              </div>
              <LocationMap value={point} onChange={chooseLocation} />
              <div className="selected-coordinates" aria-live="polite">
                {point
                  ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}`
                  : "No location selected · choose a point or enter coordinates"}
              </div>
            </section>
            <section className="card live-summary">
              <span className="eyebrow">YOUR REQUEST, AT A GLANCE</span>
              <h2>{form.title.trim() || "Untitled verification"}</h2>
              <dl>
                <div>
                  <dt>Category</dt>
                  <dd>
                    {categoryLabels[
                      form.category as keyof typeof categoryLabels
                    ] ?? "Not selected"}
                  </dd>
                </div>
                <div>
                  <dt>Evidence requirements</dt>
                  <dd>{form.evidenceRequirements.length || "None selected"}</dd>
                </div>
                <div>
                  <dt>Maximum budget</dt>
                  <dd>
                    {form.budget.trim() !== "" &&
                    Number.isFinite(Number(form.budget)) &&
                    Number(form.budget) >= 0
                      ? `$${Number(form.budget).toFixed(2)} USD`
                      : "Not approved yet"}
                  </dd>
                </div>
                <div>
                  <dt>Initial status</dt>
                  <dd>Draft · unassigned</dd>
                </div>
              </dl>
            </section>
            <div className="draft-note">
              <ShieldCheck size={20} />
              <div>
                <h3>Local prototype</h3>
                <p>
                  Drafts are saved to your workspace. The map uses public OpenStreetMap
                  tiles for development, not a production hosting service.
                </p>
              </div>
            </div>
          </aside>
        </form>
      )}
    </VerificationShell>
  );
}
