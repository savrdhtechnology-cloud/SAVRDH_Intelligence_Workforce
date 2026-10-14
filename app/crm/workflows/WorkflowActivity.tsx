"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Circle, Clock, Loader2, Mail, MessageSquare, RefreshCw, Search,
  ShieldCheck, Users, XCircle
} from "lucide-react";
import { crmSupabase } from "../supabase-client";
import "./activity.css";

type Step={label:string;type:string;action:string|null;status:string;error:string|null;at:string|null};
type Run={id:string;workflow:string;state:string;error:string|null;trigger:string;started_at:string;completed_at:string|null;
  seconds:number|null;agent:string|null;task:string|null;lead:{id:string|null;name:string|null;project:string};steps:Step[];customer_messages:number};
type Msg={at:string;channel:string;kind:string;status:string;recipient:string|null;subject:string|null;preview:string|null;stage:string|null;
  lead_id:string|null;lead:string|null;project:string;by:string|null;delivery:string|null};
type MsgLog={summary:{sent:number;waiting:number;not_sent:number;customers:number};items:Msg[]};

const PROJECT:Record<string,string>={akbs:"AKBS Poultry",engagex:"EngageX",other:"Other"};
const project=(k:string)=>PROJECT[k]||k;

function when(v:string|null){
  if(!v) return "";
  return new Date(v).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
}
function stepText(s:Step,trigger:string){
  if(s.type==="TRIGGER") return trigger==="AUTONOMOUS_TASK"?"Started automatically by the autopilot":"Started manually";
  if(s.type==="END") return "Finished";
  if(s.type==="ACTION"){
    switch(s.action){
      case "UPDATE_TASK": return "Moved the task forward";
      case "ADD_NOTE": return "Wrote a note on the lead (internal)";
      case "CREATE_TASK": return "Created a task";
      case "CREATE_FOLLOWUP": return "Scheduled a follow-up";
      default: return s.label;
    }
  }
  const map:Record<string,string>={AI_AGENT:"AI agent worked on it",CONDITION:"Checked a condition",WAIT:"Waited",HUMAN_APPROVAL:"Waited for human approval",
    NOTIFICATION:"Prepared a notification",ESCALATION:"Escalated to a person",TASK:"Created a task",FOLLOW_UP:"Scheduled a follow-up"};
  return map[s.type]||s.label;
}
function statusTone(s:string){
  if(["sent","delivered","read","completed"].includes(s)) return "ok";
  if(s.startsWith("waiting")||["queued","running","waiting_approval","approved, not sent yet"].includes(s)) return "warn";
  if(s.startsWith("not sent")||s.startsWith("draft")) return "muted";
  return "bad";
}

export default function WorkflowActivity({view}:{view:"runs"|"messages"}){
  return view==="runs"?<RunLog/>:<MessageLog/>;
}

/* ------------------------------ What happened ------------------------------ */
function RunLog(){
  const [runs,setRuns]=useState<Run[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [open,setOpen]=useState<string|null>(null);
  const [q,setQ]=useState("");
  const [proj,setProj]=useState("all");
  const [agent,setAgent]=useState("all");

  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error:e}=await crmSupabase.rpc("sav_ai_crm_workflow_run_log",{p_limit:150});
    if(e) setError(e.message); else {setError(null);setRuns(Array.isArray(data)?data as Run[]:[]);}
    setLoading(false);
  },[]);
  useEffect(()=>{void load();},[load]);

  const agents=useMemo(()=>Array.from(new Set(runs.map(r=>r.agent).filter(Boolean))) as string[],[runs]);
  const projects=useMemo(()=>Array.from(new Set(runs.map(r=>r.lead.project))),[runs]);
  const shown=runs.filter(r=>(proj==="all"||r.lead.project===proj)&&(agent==="all"||r.agent===agent)
    &&(!q.trim()||`${r.lead.name||""} ${r.task||""} ${r.workflow}`.toLowerCase().includes(q.trim().toLowerCase())));
  const failed=runs.filter(r=>r.state==="failed").length;
  const contacted=runs.reduce((s,r)=>s+r.customer_messages,0);

  return <section className="wa-wrap">
    <div className="wa-summary">
      <div><CheckCircle2 size={16}/><b>{runs.filter(r=>r.state==="completed").length}</b><span>runs finished</span></div>
      <div className={failed?"bad":""}><XCircle size={16}/><b>{failed}</b><span>runs failed</span></div>
      <div><Users size={16}/><b>{new Set(runs.map(r=>r.lead.id).filter(Boolean)).size}</b><span>leads worked on</span></div>
      <div className={contacted?"warn":""}><Mail size={16}/><b>{contacted}</b><span>customer messages from runs</span></div>
    </div>
    <div className="wa-filters">
      <label className="wa-search"><Search size={14}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search lead or task" aria-label="Search runs"/></label>
      <select value={proj} onChange={e=>setProj(e.target.value)} aria-label="Project"><option value="all">All projects</option>{projects.map(p=><option key={p} value={p}>{project(p)}</option>)}</select>
      <select value={agent} onChange={e=>setAgent(e.target.value)} aria-label="Agent"><option value="all">All agents</option>{agents.map(a=><option key={a}>{a}</option>)}</select>
      <button onClick={()=>void load()} className="wa-btn" disabled={loading}><RefreshCw size={14}/> Refresh</button>
    </div>
    {error&&<div className="wa-error"><AlertTriangle size={15}/> {error}</div>}
    {loading&&!runs.length?<div className="wa-empty"><Loader2 size={20} className="spin"/> Loading runs…</div>
    :shown.length===0?<div className="wa-empty">No runs match these filters.</div>
    :<ul className="wa-list">{shown.map(r=>{
      const isOpen=open===r.id;
      return <li key={r.id} className={"wa-run "+r.state}>
        <button className="wa-run-head" onClick={()=>setOpen(isOpen?null:r.id)} aria-expanded={isOpen}>
          <span className={"wa-pill "+statusTone(r.state)}>{r.state==="completed"?"Done":r.state==="failed"?"Failed":r.state}</span>
          <span className="wa-run-main">
            <b>{r.agent||"Workflow"}</b> worked on <b>{r.lead.name||"no lead"}</b> <em>{project(r.lead.project)}</em>
            <small>{r.task||r.workflow}</small>
          </span>
          <span className={"wa-msgs "+(r.customer_messages?"warn":"")}>{r.customer_messages?<><Mail size={13}/> {r.customer_messages} sent to customer</>:<><ShieldCheck size={13}/> No customer contact</>}</span>
          <time>{when(r.started_at)}</time>
          <ChevronDown size={15} className={"wa-chev"+(isOpen?" open":"")}/>
        </button>
        {isOpen&&<div className="wa-run-body">
          <ol className="wa-steps">{r.steps.map((s,i)=><li key={i} className={s.status}>
            {s.status==="completed"?<CheckCircle2 size={14}/>:s.status==="failed"?<XCircle size={14}/>:<Circle size={14}/>}
            <span>{stepText(s,r.trigger)}{s.error?<small className="wa-err"> — {s.error}</small>:null}</span>
          </li>)}{r.steps.length===0&&<li>No step details recorded.</li>}</ol>
          <dl className="wa-facts">
            <div><dt>Workflow</dt><dd>{r.workflow}</dd></div>
            <div><dt>Took</dt><dd>{r.seconds!=null?`${r.seconds} s`:"—"}</dd></div>
            <div><dt>Customer</dt><dd>{r.customer_messages?`${r.customer_messages} message(s) sent`:"Not contacted by this run"}</dd></div>
            {r.error&&<div><dt>Error</dt><dd className="wa-err">{r.error}</dd></div>}
          </dl>
        </div>}
      </li>;
    })}</ul>}
  </section>;
}

/* ---------------------------- Customer messages ---------------------------- */
function MessageLog(){
  const [log,setLog]=useState<MsgLog|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [open,setOpen]=useState<number|null>(null);
  const [q,setQ]=useState("");
  const [proj,setProj]=useState("all");
  const [status,setStatus]=useState("all");

  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error:e}=await crmSupabase.rpc("sav_ai_crm_customer_message_log",{p_limit:300});
    if(e) setError(e.message); else {setError(null);setLog(data as MsgLog);}
    setLoading(false);
  },[]);
  useEffect(()=>{void load();},[load]);

  const items=log?.items||[];
  const projects=Array.from(new Set(items.map(i=>i.project)));
  const shown=items.filter(i=>(proj==="all"||i.project===proj)
    &&(status==="all"||(status==="sent"?statusTone(i.status)==="ok":status==="waiting"?i.status.startsWith("waiting"):statusTone(i.status)!=="ok"&&!i.status.startsWith("waiting")))
    &&(!q.trim()||`${i.lead||""} ${i.recipient||""} ${i.subject||""}`.toLowerCase().includes(q.trim().toLowerCase())));

  return <section className="wa-wrap">
    <div className="wa-summary">
      <div><Mail size={16}/><b>{log?.summary.sent??0}</b><span>messages sent</span></div>
      <div><Users size={16}/><b>{log?.summary.customers??0}</b><span>customers reached</span></div>
      <div className={log?.summary.waiting?"warn":""}><Clock size={16}/><b>{log?.summary.waiting??0}</b><span>waiting for your approval</span></div>
      <div><XCircle size={16}/><b>{log?.summary.not_sent??0}</b><span>stopped / not sent</span></div>
    </div>
    <div className="wa-filters">
      <label className="wa-search"><Search size={14}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search lead, email or subject" aria-label="Search messages"/></label>
      <select value={proj} onChange={e=>setProj(e.target.value)} aria-label="Project"><option value="all">All projects</option>{projects.map(p=><option key={p} value={p}>{project(p)}</option>)}</select>
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Status"><option value="all">All</option><option value="sent">Sent</option><option value="waiting">Waiting for approval</option><option value="not">Not sent</option></select>
      <button onClick={()=>void load()} className="wa-btn" disabled={loading}><RefreshCw size={14}/> Refresh</button>
    </div>
    {error&&<div className="wa-error"><AlertTriangle size={15}/> {error}</div>}
    {loading&&!log?<div className="wa-empty"><Loader2 size={20} className="spin"/> Loading messages…</div>
    :shown.length===0?<div className="wa-empty">No customer messages match these filters.</div>
    :<ul className="wa-list">{shown.map((m,idx)=>{
      const isOpen=open===idx;
      return <li key={m.at+idx} className="wa-run">
        <button className="wa-run-head" onClick={()=>setOpen(isOpen?null:idx)} aria-expanded={isOpen}>
          <span className={"wa-pill "+statusTone(m.status)}>{m.status}</span>
          <span className="wa-run-main">
            {m.channel==="email"?<Mail size={13}/>:<MessageSquare size={13}/>} <b>{m.kind}</b> to <b>{m.lead||"unknown lead"}</b> <em>{project(m.project)}</em>
            <small>{m.recipient||"no address"}{m.subject?` · ${m.subject}`:""}</small>
          </span>
          <span className="wa-by">{m.by||""}</span>
          <time>{when(m.at)}</time>
          <ChevronDown size={15} className={"wa-chev"+(isOpen?" open":"")}/>
        </button>
        {isOpen&&<div className="wa-run-body">
          {m.subject&&<p className="wa-subject">Subject: <b>{m.subject}</b></p>}
          <pre className="wa-preview">{m.preview||"(no text stored)"}{m.preview&&m.preview.length>=280?"…":""}</pre>
          <dl className="wa-facts">
            <div><dt>Channel</dt><dd>{m.channel}</dd></div>
            {m.stage&&<div><dt>Lead stage</dt><dd>{m.stage.replaceAll("_"," ").toLowerCase()}</dd></div>}
            <div><dt>Delivery</dt><dd>{m.delivery||(statusTone(m.status)==="ok"?"no provider result stored":"—")}</dd></div>
          </dl>
          {m.kind.startsWith("Reminder")&&<p className="wa-note">Reminder text shown is the current template for this lead.</p>}
        </div>}
      </li>;
    })}</ul>}
  </section>;
}
