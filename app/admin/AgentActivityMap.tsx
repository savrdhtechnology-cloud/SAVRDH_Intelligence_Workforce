"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlertTriangle, Bot, CheckCircle2, ClipboardCheck, Clock, FolderKanban, Loader2, Mail,
  PauseCircle, RefreshCw, Workflow, Zap
} from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "../crm/supabase-client";

type Counts={completed:number;open:number;paused:number};
type Agent={id:string;slug:string;name:string;role:string;status:string;completed:number;open:number;paused:number;
  completed_24h:number;last_activity_at:string|null;projects:Record<string,Counts>};
type Project={key:string;name:string;autopilot:boolean;leads:number;by_stage:Record<string,number>};
type FeedItem={at:string;type:string;title:string|null;lead:string|null;project:string;agent:string|null};
type Overview={
  generated_at:string;
  autopilot:{last_run_at:string|null;last_status:string|null;runs_24h:number;failed_24h:number;schedule:string}|null;
  approvals:{emails:number;trials:number;agent_actions:number};
  projects:Project[];agents:Agent[];feed:FeedItem[];
};

const REFRESH_MS=30000;
const STAGE_ORDER=["NEW","CONTACTED","FEE_PENDING","FEE_REVIEW","DOCUMENTS","QUALIFIED","PROPOSAL","NEGOTIATION","CLOSED"];
const STAGE_AGENT:Record<string,string>={NEW:"SAV-Sales",CONTACTED:"SAV-Followup",DOCUMENTS:"SAV-Document",QUALIFIED:"SAV-Credit",
  PROPOSAL:"SAV-Sales-Manager",NEGOTIATION:"SAV-Sales-Manager",FEE_PENDING:"On hold until fee",FEE_REVIEW:"On hold, fee under review",CLOSED:"Finished"};

function ago(value:string|null){
  if(!value) return "never";
  const s=Math.max(0,(Date.now()-new Date(value).getTime())/1000);
  if(s<60) return "just now";
  if(s<3600) return `${Math.round(s/60)} min ago`;
  if(s<86400) return `${Math.round(s/3600)} h ago`;
  return `${Math.round(s/86400)} d ago`;
}
function label(stage:string){return stage.replaceAll("_"," ").toLowerCase();}
function feedText(item:FeedItem){
  switch(item.type){
    case "task_completed": return "Completed a task";
    case "workflow_task_updated": return "Worked on a task";
    case "agent_task_created": case "agent_autonomous_work_created": case "agent_work_routed": case "workflow_task_created": return "Picked up new work";
    case "akbs_fee_gate_applied": return item.title||"Fee pending — work on hold";
    case "akbs_fee_gate_released": return "Fee verified — work released";
    case "autopilot_reminder_awaiting_approval": return "Reminder email waiting for your approval";
    case "autopilot_reminder_queued": return "Reminder email sent";
    case "autopilot_reminder_rejected": return "Reminder email skipped";
    case "autonomous_dispatch_failed": return "Run failed";
    default: return item.title||item.type;
  }
}

export default function AgentActivityMap({onOpen}:{onOpen:(section:"approvals"|"library")=>void}){
  const [data,setData]=useState<Overview|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState<"map"|"agents"|"projects">("map");
  const [focus,setFocus]=useState<{kind:"agent"|"project";key:string}|null>(null);

  const load=useCallback(async()=>{
    if(!crmSupabaseConfigured){setLoading(false);return;}
    const {data:res,error:rpcError}=await crmSupabase.rpc("sav_ai_crm_agent_activity_overview");
    if(rpcError) setError(rpcError.message);
    else{setError(null);setData(res as Overview);}
    setLoading(false);
  },[]);

  useEffect(()=>{
    void load();
    const id=window.setInterval(()=>{if(document.visibilityState==="visible") void load();},REFRESH_MS);
    return ()=>window.clearInterval(id);
  },[load]);

  const workforce=useMemo(()=>{
    const agents=(data?.agents||[]).filter(a=>a.status!=="disabled");
    const working=agents.filter(a=>a.completed+a.open+a.paused>0||a.status==="active");
    return working.sort((a,b)=>(b.completed+b.open)-(a.completed+a.open));
  },[data]);

  const feed=useMemo(()=>{
    const items=data?.feed||[];
    if(!focus) return items;
    return items.filter(i=>focus.kind==="project"?i.project===focus.key:i.agent===focus.key);
  },[data,focus]);

  if(loading) return <div className="savos-panel savos-empty"><Loader2 size={24} className="savos-spin"/><small>Loading live agent activity…</small></div>;
  if(error) return <div className="savos-panel"><div className="savos-error" role="alert"><AlertTriangle size={16}/> {error}</div><button className="savos-ghost" onClick={()=>void load()}><RefreshCw size={14}/> Retry</button></div>;
  if(!data) return null;

  const ap=data.autopilot;
  const autopilotOk=ap&&ap.last_status==="succeeded"&&ap.failed_24h===0;
  const pending=data.approvals.emails+data.approvals.trials+data.approvals.agent_actions;
  const done24=workforce.reduce((s,a)=>s+a.completed_24h,0);
  const activeAgents=workforce.filter(a=>a.status==="active").length;
  const totalLeads=data.projects.reduce((s,p)=>s+p.leads,0);

  return <div className="savos-live">
    <div className="savos-live-stats">
      <Stat icon={Zap} tone={autopilotOk?"ok":"warn"} label="Autopilot" value={autopilotOk?"Running":"Check"} sub={ap?`last run ${ago(ap.last_run_at)} · ${ap.runs_24h-ap.failed_24h}/${ap.runs_24h} ok today`:"no runs yet"}/>
      <Stat icon={Bot} label="Agents active" value={String(activeAgents)} sub={`${workforce.length} in the workforce`}/>
      <Stat icon={FolderKanban} label="Leads in projects" value={String(totalLeads)} sub={data.projects.map(p=>`${p.name} ${p.leads}`).join(" · ")}/>
      <Stat icon={CheckCircle2} label="Tasks done (24 h)" value={String(done24)} sub="by all agents"/>
      <button className="savos-live-stat-btn" onClick={()=>onOpen("approvals")}>
        <Stat icon={ClipboardCheck} tone={pending?"warn":"ok"} label="Waiting for you" value={String(pending)} sub={pending?`${data.approvals.emails} emails · ${data.approvals.trials} trials`:"nothing to approve"}/>
      </button>
    </div>

    <div className="savos-panel">
      <div className="savos-section-title">
        <div><small>LIVE · REFRESHES EVERY 30 S</small><h2>What the agents are doing</h2></div>
        <div className="savos-live-tabs" role="tablist">
          {(["map","agents","projects"] as const).map(v=><button key={v} role="tab" aria-selected={view===v} className={view===v?"on":""} onClick={()=>setView(v)}>
            {v==="map"?"Flow map":v==="agents"?"Agent-wise":"Project-wise"}</button>)}
          <button className="savos-ghost" onClick={()=>void load()} title="Refresh now"><RefreshCw size={14}/></button>
        </div>
      </div>

      {view==="map"&&<FlowMap projects={data.projects} agents={workforce} focus={focus} setFocus={setFocus}/>}
      {view==="agents"&&<div className="savos-live-grid">{workforce.map(a=><AgentCard key={a.id} agent={a} projects={data.projects} selected={focus?.kind==="agent"&&focus.key===a.slug} onSelect={()=>setFocus(focus?.key===a.slug?null:{kind:"agent",key:a.slug})}/>)}</div>}
      {view==="projects"&&<div className="savos-live-grid">{data.projects.map(p=><ProjectCard key={p.key} project={p} agents={workforce} selected={focus?.kind==="project"&&focus.key===p.key} onSelect={()=>setFocus(focus?.key===p.key?null:{kind:"project",key:p.key})}/>)}</div>}
    </div>

    <div className="savos-panel">
      <div className="savos-section-title">
        <div><small>ACTIVITY FEED</small><h2>{focus?`Activity · ${focus.kind==="project"?(data.projects.find(p=>p.key===focus.key)?.name||focus.key):(workforce.find(a=>a.slug===focus.key)?.name||focus.key)}`:"Latest activity"}</h2></div>
        {focus&&<button className="savos-ghost" onClick={()=>setFocus(null)}>Show all</button>}
      </div>
      {feed.length===0?<div className="savos-empty"><Clock size={24}/><small>No activity yet for this filter.</small></div>:
      <ul className="savos-feed">
        <AnimatePresence initial={false}>
          {feed.map(item=><motion.li key={item.at+item.type+(item.lead||"")} layout initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} exit={{opacity:0}} transition={{duration:.25}}>
            <span className={"savos-feed-dot "+(item.type.includes("failed")?"bad":item.type.includes("fee_gate_applied")||item.type.includes("awaiting")?"warn":"ok")}/>
            <div><b>{item.agent==="autopilot"?"Autopilot":(workforce.find(a=>a.slug===item.agent)?.name||item.agent||"Workflow")}</b> {feedText(item)}
              <small>{item.lead?`${item.lead} · `:""}{data.projects.find(p=>p.key===item.project)?.name||item.project}</small></div>
            <time>{ago(item.at)}</time>
          </motion.li>)}
        </AnimatePresence>
      </ul>}
    </div>
  </div>;
}

function Stat({icon:Icon,label,value,sub,tone}:{icon:typeof Bot;label:string;value:string;sub:string;tone?:"ok"|"warn"}){
  return <div className={"savos-live-stat "+(tone||"")}><Icon size={17}/><div><small>{label}</small><b>{value}</b><span>{sub}</span></div></div>;
}

/* ---------- Flow map: projects → autopilot → agents, animated by real task counts ---------- */
function FlowMap({projects,agents,focus,setFocus}:{projects:Project[];agents:Agent[];focus:{kind:"agent"|"project";key:string}|null;setFocus:(f:{kind:"agent"|"project";key:string}|null)=>void}){
  const W=1000, rowH=62;
  const H=Math.max(300,Math.max(projects.length,agents.length)*rowH+60);
  const px=150, hx=500, ax=850;
  const py=(i:number)=>H/2+(i-(projects.length-1)/2)*Math.max(rowH,Math.min(110,(H-60)/Math.max(projects.length,1)));
  const ay=(i:number)=>H/2+(i-(agents.length-1)/2)*rowH;
  const hy=H/2;

  const links=agents.flatMap((a,ai)=>projects.map((p,pi)=>{
    const c=a.projects?.[p.key];
    const total=c?c.completed+c.open+c.paused:0;
    return total>0?{a,ai,p,pi,total,live:(c!.open>0),paused:c!.paused>0&&c!.open===0}:null;
  }).filter(Boolean)) as Array<{a:Agent;ai:number;p:Project;pi:number;total:number;live:boolean;paused:boolean}>;
  const dim=(kind:"agent"|"project",key:string)=>focus&&!(focus.kind===kind&&focus.key===key);

  return <div className="savos-flow">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Flow of work from projects through the autopilot to each agent">
      <defs>
        <linearGradient id="flowGrad" x1="0" x2="1"><stop offset="0" stopColor="#3f8fd8"/><stop offset="1" stopColor="#49d6c4"/></linearGradient>
      </defs>
      {/* project → hub */}
      {projects.map((p,i)=>{
        const d=`M${px+70},${py(i)} C${px+190},${py(i)} ${hx-170},${hy} ${hx-58},${hy}`;
        const off=!p.autopilot;
        return <g key={"ph"+p.key} opacity={dim("project",p.key)?.15:1}>
          <path d={d} className={"savos-flow-edge "+(off?"off":"")} strokeWidth={off?1.5:3}/>
          {!off&&<circle r="4" className="savos-flow-dot"><animateMotion dur="3s" repeatCount="indefinite" path={d}/></circle>}
        </g>;
      })}
      {/* hub → agent, width = tasks handled */}
      {agents.map((a,i)=>{
        const total=a.completed+a.open+a.paused;
        const d=`M${hx+58},${hy} C${hx+170},${hy} ${ax-190},${ay(i)} ${ax-82},${ay(i)}`;
        const w=1.5+5*(total/Math.max(1,...agents.map(x=>x.completed+x.open+x.paused)));
        const paused=a.status!=="active";
        const projectFocusOff=focus?.kind==="project"&&!(a.projects?.[focus.key]);
        return <g key={"ha"+a.slug} opacity={(focus?.kind==="agent"&&focus.key!==a.slug)||projectFocusOff?.15:1}>
          <path d={d} className={"savos-flow-edge "+(paused?"off":"")} strokeWidth={w}/>
          {!paused&&total>0&&<circle r="3.5" className={"savos-flow-dot"+(a.open>0?" busy":"")}>
            <animateMotion dur={a.open>0?"1.6s":(a.completed_24h>0?"2.6s":"4.5s")} repeatCount="indefinite" path={d}/>
          </circle>}
        </g>;
      })}
      {/* hub */}
      <g className="savos-flow-hub" transform={`translate(${hx},${hy})`}>
        <circle r="56" className="ring"/><circle r="44" className="core"/>
        <text y="-4" textAnchor="middle">Autopilot</text>
        <text y="14" textAnchor="middle" className="sub">every hour</text>
      </g>
      {/* projects */}
      {projects.map((p,i)=><g key={"p"+p.key} transform={`translate(${px},${py(i)})`} className={"savos-flow-node project"+(focus?.key===p.key?" sel":"")} opacity={dim("project",p.key)?.35:1}
        onClick={()=>setFocus(focus?.key===p.key?null:{kind:"project",key:p.key})} role="button" tabIndex={0}
        onKeyDown={e=>{if(e.key==="Enter")setFocus(focus?.key===p.key?null:{kind:"project",key:p.key});}}>
        <rect x="-110" y="-24" width="180" height="48" rx="12"/>
        <text x="-96" y="-3">{p.name}</text>
        <text x="-96" y="14" className="sub">{p.leads} leads · {p.autopilot?"autopilot on":"not connected yet"}</text>
      </g>)}
      {/* agents */}
      {agents.map((a,i)=>{
        const total=a.completed+a.open+a.paused;
        return <g key={"a"+a.slug} transform={`translate(${ax},${ay(i)})`} className={"savos-flow-node agent "+(a.status!=="active"?"paused":a.open>0?"busy":"")+(focus?.key===a.slug?" sel":"")}
          opacity={dim("agent",a.slug)&&!(focus?.kind==="project"&&a.projects?.[focus.key])?.35:1}
          onClick={()=>setFocus(focus?.key===a.slug?null:{kind:"agent",key:a.slug})} role="button" tabIndex={0}
          onKeyDown={e=>{if(e.key==="Enter")setFocus(focus?.key===a.slug?null:{kind:"agent",key:a.slug});}}>
          <rect x="-80" y="-23" width="200" height="46" rx="12"/>
          <circle cx="-62" cy="0" r="6" className="led"/>
          <text x="-48" y="-3">{a.name}</text>
          <text x="-48" y="14" className="sub">{a.status!=="active"?a.status:`${a.completed} done · ${a.open} open${a.paused?` · ${a.paused} on hold`:""}`}{total===0&&a.status==="active"?" · waiting for work":""}</text>
        </g>;
      })}
    </svg>
    <div className="savos-flow-legend">
      <span><i className="dot"/> moving dot = agent receiving work (faster = busier)</span>
      <span><i className="thick"/> thicker line = more tasks handled</span>
      <span><i className="off"/> dashed = paused or project not connected</span>
      <span>Click a project or agent to filter the feed</span>
    </div>
    {links.length===0&&<p className="savos-flow-note">No agent tasks yet.</p>}
  </div>;
}

function AgentCard({agent:a,projects,selected,onSelect}:{agent:Agent;projects:Project[];selected:boolean;onSelect:()=>void}){
  const total=Math.max(1,a.completed+a.open+a.paused);
  return <button className={"savos-live-card"+(selected?" sel":"")} onClick={onSelect}>
    <header><span className={"savos-led "+(a.status!=="active"?"paused":a.open>0?"busy":"")}/><b>{a.name}</b><em>{a.status==="active"?(a.open>0?"working":"idle — waiting for work"):a.status}</em></header>
    <small>{a.role}</small>
    <div className="savos-live-bar" aria-label={`${a.completed} done, ${a.open} open, ${a.paused} on hold`}>
      <i className="done" style={{width:`${a.completed/total*100}%`}}/><i className="open" style={{width:`${a.open/total*100}%`}}/><i className="hold" style={{width:`${a.paused/total*100}%`}}/>
    </div>
    <div className="savos-live-nums"><span><CheckCircle2 size={13}/> {a.completed} done</span><span><Activity size={13}/> {a.open} open</span><span><PauseCircle size={13}/> {a.paused} on hold</span></div>
    <div className="savos-live-tags">{Object.entries(a.projects||{}).map(([k,c])=><span key={k}>{projects.find(p=>p.key===k)?.name||k}: {c.completed+c.open+c.paused}</span>)}
      {Object.keys(a.projects||{}).length===0&&<span>No project work yet</span>}</div>
    <footer><Clock size={12}/> last active {ago(a.last_activity_at)} · {a.completed_24h} done today</footer>
  </button>;
}

function ProjectCard({project:p,agents,selected,onSelect}:{project:Project;agents:Agent[];selected:boolean;onSelect:()=>void}){
  const stages=Object.entries(p.by_stage).sort((x,y)=>(STAGE_ORDER.indexOf(x[0])+99)%99-(STAGE_ORDER.indexOf(y[0])+99)%99);
  const working=agents.filter(a=>a.projects?.[p.key]);
  return <button className={"savos-live-card"+(selected?" sel":"")} onClick={onSelect}>
    <header><FolderKanban size={15}/><b>{p.name}</b><em>{p.autopilot?"autopilot on":"not connected yet"}</em></header>
    <small>{p.leads} leads</small>
    <div className="savos-stage-list">{stages.map(([s,c])=><div key={s}>
      <span>{label(s)}</span><i style={{width:`${c/Math.max(1,p.leads)*100}%`}}/><b>{c}</b>
      <small>{p.autopilot?(STAGE_AGENT[s]||""):""}</small>
    </div>)}</div>
    <div className="savos-live-tags">{working.map(a=><span key={a.slug}>{a.name}: {(a.projects[p.key].completed+a.projects[p.key].open+a.projects[p.key].paused)}</span>)}
      {working.length===0&&<span>No agent work yet</span>}</div>
    {!p.autopilot&&<footer><Workflow size={12}/> Agents ran here only when asked; the hourly autopilot covers AKBS for now.</footer>}
    {p.autopilot&&<footer><Mail size={12}/> Customer emails go to your approval first.</footer>}
  </button>;
}
