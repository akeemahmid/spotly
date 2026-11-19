"use client";
import { useRef, useState } from "react";
import { readStoredTasks } from "@/lib/task-storage";
import { api, verificationStore } from "@/lib/use-verifications";
export function ImportLocalDrafts() {
 const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
 const [confirmed,setConfirmed]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 async function run() {
  if(!confirmed || busy) return;
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
 return <>
  <button type="button" className="button secondary" aria-haspopup="dialog" onClick={()=>{setConfirmed(false);dialog.current?.showModal();}}>Import drafts</button>
  <dialog ref={dialog} className="modal draft-import-dialog" aria-labelledby="import-drafts-title" aria-describedby="import-drafts-description" onCancel={event=>{if(busy)event.preventDefault();}}>
   <h2 id="import-drafts-title">Import browser drafts</h2>
   <p id="import-drafts-description" className="modal-description">Share drafts saved in this browser with your current workspace.</p>
   <ul className="import-notices">
    <li>Matching IDs are skipped without overwriting workspace records.</li>
    <li>Your browser originals stay intact, including any data that cannot be imported.</li>
    <li>Imported plans remain untrusted. A new SERV plan is required before assignment.</li>
   </ul>
   <form onSubmit={event=>{event.preventDefault();void run();}}>
    <label className="import-confirmation"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy} required /><span>I want to share these drafts with this workspace.</span></label>
    <p role="status" className="import-feedback">{message}</p>
    <div className="modal-actions">
     <button type="button" className="button secondary" onClick={()=>dialog.current?.close()} disabled={busy}>Close</button>
     <button type="submit" className="button primary" disabled={busy || !confirmed}>{busy?"Importing…":"Import drafts"}</button>
    </div>
   </form>
  </dialog>
 </>;
}
