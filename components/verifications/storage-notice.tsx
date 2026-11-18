"use client";
import { AlertCircle } from "lucide-react";
export function StorageNotice({
  issue,
  retry,
}: {
  issue: string | null;
  retry: () => void;
}) {
  if (!issue) return null;
  return (
    <div className="storage-notice" role="alert">
      <AlertCircle size={18} />
      <p>{issue}</p>
      <button type="button" className="button secondary" onClick={retry}>
        Retry loading
      </button>
    </div>
  );
}
