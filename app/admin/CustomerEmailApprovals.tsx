"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, RefreshCw, Send, ShieldCheck, SkipForward, XCircle } from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "../crm/supabase-client";

type EmailApproval={
  id:string;status:"pending"|"sent"|"rejected"|"superseded"|"failed";stage:string;attempt:number;
  recipient:string;subject:string;body:string;lead_id:string;lead_title:string|null;lead_status:string|null;
  created_at:string;decided_at:string|null;decision_note:string|null;error:string|null;decided_by:string|null;
};

const STATUS_LABEL:Record<EmailApproval["status"],string>={
  pending:"Waiting for your approval",sent:"Sent",rejected:"Skipped — not sent",superseded:"Cancelled — lead changed, not sent",failed:"Failed — not sent"
};

function when(value:string|null){
  if(!value) return "";
  return new Date(value).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
}

export default function CustomerEmailApprovals(){
  const [items,setItems]=useState<EmailApproval[]>([]);
  const [canApprove,setCanApprove]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState<string|null>(null);
  const [notes,setNotes]=useState<Record<string,string>>({});

  const load=useCallback(async()=>{
    if(!crmSupabaseConfigured){setLoading(false);return;}
    setLoading(true);setError(null);
    const {data,error:rpcError}=await crmSupabase.rpc("sav_ai_crm_customer_email_approvals");
    if(rpcError) setError(rpcError.message);
    else{
      const payload=(data||{}) as {can_approve?:boolean;items?:EmailApproval[]};
      setCanApprove(payload.can_approve===true);
      setItems(Array.isArray(payload.items)?payload.items:[]);
    }
    setLoading(false);
  },[]);

  useEffect(()=>{void load();},[load]);

  async function review(item:EmailApproval,decision:"approve"|"reject"){
    if(decision==="approve"&&!window.confirm(`Send this email to ${item.recipient} now?`)) return;
    setBusy(item.id);setError(null);
    const {data,error:rpcError}=await crmSupabase.rpc("sav_ai_crm_review_customer_email",{p_approval_id:item.id,p_decision:decision,p_note:notes[item.id]||null});
    if(rpcError) setError(rpcError.message);
    else{
      const result=(data||{}) as {ok?:boolean;error?:string};
      if(result.ok===false&&result.error) setError(result.error);
    }
    setBusy(null);await load();
  }

  const pending=items.filter(i=>i.status==="pending");
  const history=items.filter(i=>i.status!=="pending");

  return <div className="savos-panel">
    <div className="savos-section-title">
      <div><small>CUSTOMER EMAILS</small><h2>Email approvals ({pending.length} waiting)</h2></div>
      <button className="savos-ghost" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Refresh</button>
    </div>
    <p>No email reaches an AKBS customer until an owner or admin approves it here. If the lead changes before you decide, the email is cancelled automatically and nothing is sent.</p>
    {!canApprove&&!loading&&<div className="savos-hint"><ShieldCheck size={16}/> Only an owner or admin can approve customer emails.</div>}
    {error&&<div className="savos-error" role="alert"><XCircle size={16}/> {error}</div>}

    {loading?<div className="savos-empty"><Loader2 size={24} className="savos-spin"/><small>Loading…</small></div>
    :pending.length===0?<div className="savos-empty"><CheckCircle2 size={28}/><b>No customer email is waiting</b><small>When a reminder is due, it will appear here for your approval.</small></div>
    :<div className="savos-trial-list">{pending.map(item=><article key={item.id} className="savos-trial-card">
      <header><span className="savos-tag">{STATUS_LABEL[item.status]}</span><small>{item.lead_title||"Lead"} · stage {item.stage.replace("_"," ").toLowerCase()} · reminder {item.attempt} of 3 · {when(item.created_at)}</small></header>
      <div className="savos-email-preview">
        <div><Mail size={14}/> To: <b>{item.recipient}</b></div>
        <div>Subject: <b>{item.subject}</b></div>
        <pre>{item.body}</pre>
      </div>
      {canApprove&&<div className="savos-trial-actions">
        <input aria-label="Note" placeholder="Note (optional)" value={notes[item.id]||""} onChange={e=>setNotes({...notes,[item.id]:e.target.value})}/>
        <button className="savos-link-action" disabled={busy===item.id} onClick={()=>void review(item,"approve")}>{busy===item.id?<Loader2 size={15} className="savos-spin"/>:<Send size={15}/>} Approve & send</button>
        <button className="savos-ghost danger" disabled={busy===item.id} onClick={()=>void review(item,"reject")}><SkipForward size={15}/> Don't send</button>
      </div>}
    </article>)}</div>}

    {history.length>0&&<details className="savos-email-history">
      <summary>History ({history.length})</summary>
      <div className="savos-trial-list">{history.map(item=><article key={item.id} className={"savos-trial-card "+(item.status==="sent"?"completed":item.status==="superseded"?"expired":"rejected")}>
        <header><span className="savos-tag">{STATUS_LABEL[item.status]}</span><small>{item.lead_title||"Lead"} · {item.recipient} · reminder {item.attempt} of 3{item.decided_by?` · ${item.decided_by}`:""} {when(item.decided_at)}</small></header>
        {(item.decision_note||item.error)&&<p className="savos-trial-reason">{item.error||item.decision_note}</p>}
      </article>)}</div>
    </details>}
  </div>;
}
