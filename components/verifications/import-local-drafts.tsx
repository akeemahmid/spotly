"use client";
import { useState } from "react";
import { readStoredTasks } from "@/lib/task-storage";
import { api, verificationStore } from "@/lib/use-verifications";
export function ImportLocalDrafts() {
 const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
 async function run() {
  setBusy(true); setMessage("");
  try {
   const stored=readStoredTasks(window.localStorage);
   if(stored.issue) throw new Error(stored.issue);
   let imported=0; const errors:string[]=[];
   for(const draft of stored.tasks) {
    try {await api({action:"import",draft});imported++;}
    catch(error){errors.push(`${draft.id}: ${error instanceof Error?error.message:"Import failed"}`);}
   }
   await verificationStore.refresh();
   setMessage(`${imported} imported. ${stored.tasks.length-imported} not imported. Browser originals were retained.${errors.length?` ${errors.join("; ")}`:""}`);
  }catch(error){setMessage(error instanceof Error?error.message:"Local drafts could not be read.");}
  finally{setBusy(false);}
 }
 return <section className="card form-card"><h2>Existing browser drafts</h2><p>Import drafts from this browser into your current workspace. Matching IDs are rejected without overwriting. Compatible historical plans are retained as untrusted text; generate a new SERV plan before using them. Original browser data stays intact; only import data you intend to share with this workspace.</p><button type="button" className="button secondary" onClick={run} disabled={busy}>{busy?"Importing…":"Import my local drafts"}</button><p role="status">{message}</p></section>;
}
