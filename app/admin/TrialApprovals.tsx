"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, Mail, Play, RefreshCw, ShieldCheck, Users, XCircle } from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "../crm/supabase-client";

type Preview={leads:number;by_stage:Record<string,number>;tasks_to_create:number;emails_to_send:number;queued_agent_tasks:number;computed_at:string};
type RunResult={ok:boolean;processed?:number;errors?:number;tasks_created?:number;emails_queued?:number;queue?:{processed:number;succeeded:number;failed:number};error?:string};
type TrialRequest={
  id:string;status:"pending"|"rejected"|"running"|"completed"|"failed"|"expired";reason:string;lead_limit:number;
  requested_by:string;created_at:string;expires_at:string;preview:Preview;
  decided_by:string|null;decided_at:string|null;decision_note:string|null;result:RunResult|null;error:string|null;completed_at:string|null;
};

const STATUS_LABEL:Record<TrialRequest["status"],string>={
  pending:"Waiting for your approval",rejected:"Rejected",running:"Running",completed:"Completed",failed:"Failed",expired:"Expired"
};

function when(value:string|null){
  if(!value) return "";
  return new Date(value).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
}

export default function TrialApprovals(){
  const [requests,setRequests]=useState<TrialRequest[]>([]);
  const [canApprove,setCanApprove]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [reason,setReason]=useState("");
  const [limit,setLimit]=useState(250);
  const [busy,setBusy]=useState<string|null>(null);
  const [notes,setNotes]=useState<Record<string,string>>({});

  const load=useCallback(async()=>{
    if(!crmSupabaseConfigured){setLoading(false);return;}
    setLoading(true);setError(null);
    const {data,error:rpcError}=await crmSupabase.rpc("sav_ai_crm_trial_run_requests");
    if(rpcError){setError(rpcError.message);}
    else{
      const payload=(data||{}) as {can_approve?:boolean;requests?:TrialRequest[]};
      setCanApprove(payload.can_approve===true);
      setRequests(Array.isArray(payload.requests)?payload.requests:[]);
    }
    setLoading(false);
  },[]);

  useEffect(()=>{void load();},[load]);

  async function requestTrial(){
    setBusy("new");setError(null);
    const {error:rpcError}=await crmSupabase.rpc("sav_ai_crm_request_trial_run",{p_reason:reason,p_lead_limit:limit});
    if(rpcError) setError(rpcError.message); else setReason("");
    setBusy(null);await load();
  }

  async function review(id:string,decision:"approve"|"reject"){
    if(decision==="approve"&&!window.confirm("Run this autopilot trial on AKBS leads now? Tasks and customer reminder emails shown in the preview will be created.")) return;
    setBusy(id);setError(null);
    const {data,error:rpcError}=await crmSupabase.rpc("sav_ai_crm_review_trial_run",{p_request_id:id,p_decision:decision,p_note:notes[id]||null});
    if(rpcError) setError(rpcError.message);
    else if(data&&typeof data==="object"&&(data as RunResult).ok===false&&(data as RunResult).error) setError((data as RunResult).error!);
    setBusy(null);await load();
  }

  const pending=requests.filter(r=>r.status==="pending");
  const history=requests.filter(r=>r.status!=="pending");

  return <div className="savos-approvals">
    <div className="savos-panel">
      <div className="savos-section-title">
        <div><small>AUTOPILOT TRIALS</small><h2>Trial run approvals</h2></div>
        <button className="savos-ghost" onClick={()=>void load()} disabled={loading}><RefreshCw size={14}/> Refresh</button>
      </div>
      <p>Every autopilot trial on AKBS leads waits here until an owner or admin approves it. The preview shows what it will do right now. The hourly autopilot keeps running as before.</p>
      {!canApprove&&!loading&&<div className="savos-hint"><ShieldCheck size={16}/> You can request trials. Only an owner or admin can approve them.</div>}
      {error&&<div className="savos-error" role="alert"><XCircle size={16}/> {error}</div>}

      <div className="savos-trial-form">
        <label>Why run a trial?<textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="e.g. Check new follow-up rules on AKBS leads"/></label>
        <label>Max leads<input type="number" min={1} max={500} value={limit} onChange={e=>setLimit(Math.max(1,Math.min(500,Number(e.target.value)||1)))}/></label>
        <button className="savos-link-action" onClick={()=>void requestTrial()} disabled={busy==="new"||reason.trim().length<3}>
          {busy==="new"?<Loader2 size={15} className="savos-spin"/>:<ClipboardCheck size={15}/>} Request approval
        </button>
      </div>
    </div>

    <div className="savos-panel">
      <div className="savos-section-title"><div><small>WAITING</small><h2>Pending ({pending.length})</h2></div></div>
      {loading?<div className="savos-empty"><Loader2 size={24} className="savos-spin"/><small>Loading…</small></div>
      :pending.length===0?<div className="savos-empty"><CheckCircle2 size={28}/><b>Nothing waiting for approval</b><small>New trial requests will appear here.</small></div>
      :<div className="savos-trial-list">{pending.map(r=><article key={r.id} className="savos-trial-card">
        <header><span className="savos-tag">{STATUS_LABEL[r.status]}</span><small>{r.requested_by} · {when(r.created_at)} · expires {when(r.expires_at)}</small></header>
        <p className="savos-trial-reason">{r.reason}</p>
        <PreviewStats preview={r.preview}/>
        {canApprove&&<div className="savos-trial-actions">
          <input aria-label="Note" placeholder="Note (optional)" value={notes[r.id]||""} onChange={e=>setNotes({...notes,[r.id]:e.target.value})}/>
          <button className="savos-link-action" disabled={busy===r.id} onClick={()=>void review(r.id,"approve")}>{busy===r.id?<Loader2 size={15} className="savos-spin"/>:<Play size={15}/>} Approve & run</button>
          <button className="savos-ghost danger" disabled={busy===r.id} onClick={()=>void review(r.id,"reject")}><XCircle size={15}/> Reject</button>
        </div>}
      </article>)}</div>}
    </div>

    {history.length>0&&<div className="savos-panel">
      <div className="savos-section-title"><div><small>HISTORY</small><h2>Decided trials</h2></div></div>
      <div className="savos-trial-list">{history.map(r=><article key={r.id} className={"savos-trial-card "+r.status}>
        <header><span className="savos-tag">{STATUS_LABEL[r.status]}</span><small>{r.requested_by} · {when(r.created_at)}{r.decided_by?` · ${r.status==="rejected"?"rejected":"approved"} by ${r.decided_by} ${when(r.decided_at)}`:""}</small></header>
        <p className="savos-trial-reason">{r.reason}{r.decision_note?<em> — “{r.decision_note}”</em>:null}</p>
        {r.result&&r.result.ok!==undefined&&r.status!=="rejected"&&<div className="savos-trial-stats">
          <Stat icon={Users} label="Leads checked" value={r.result.processed??0}/>
          <Stat icon={ClipboardCheck} label="Tasks created" value={r.result.tasks_created??0}/>
          <Stat icon={Mail} label="Emails queued" value={r.result.emails_queued??0}/>
          <Stat icon={XCircle} label="Errors" value={(r.result.errors??0)+(r.result.queue?.failed??0)}/>
        </div>}
        {r.error&&<div className="savos-error"><XCircle size={14}/> {r.error}</div>}
      </article>)}</div>
    </div>}
  </div>;
}

function PreviewStats({preview}:{preview:Preview}){
  const stages=Object.entries(preview?.by_stage||{});
  return <>
    <div className="savos-trial-stats">
      <Stat icon={Users} label="AKBS leads" value={preview?.leads??0}/>
      <Stat icon={ClipboardCheck} label="New agent tasks" value={preview?.tasks_to_create??0}/>
      <Stat icon={Mail} label="Customer emails" value={preview?.emails_to_send??0} warn={(preview?.emails_to_send??0)>0}/>
      <Stat icon={Play} label="Agent tasks to run" value={preview?.queued_agent_tasks??0}/>
    </div>
    {stages.length>0&&<div className="savos-trial-stages">{stages.map(([stage,count])=><span key={stage}>{stage.replace("_"," ").toLowerCase()} <b>{count}</b></span>)}</div>}
  </>;
}

function Stat({icon:Icon,label,value,warn}:{icon:typeof Users;label:string;value:number;warn?:boolean}){
  return <div className={"savos-trial-stat"+(warn?" warn":"")}><Icon size={15}/><b>{value}</b><small>{label}</small></div>;
}
