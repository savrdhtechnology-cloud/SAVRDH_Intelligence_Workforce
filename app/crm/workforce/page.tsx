"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, Bot, Boxes, ExternalLink, ShieldCheck, Workflow } from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "../supabase-client";
import { listAgents } from "../agents/agent-service";
import type { AgentRecord } from "../agents/agent-types";

const products = [
 {id:"technology",name:"Savrdh Technology CRM",scope:"Leads, sales follow-up and customer support"},
 {id:"engagex",name:"EngageX",scope:"Approved campaign planning and customer communication"},
 {id:"autoos",name:"Savrdh AutoOS",scope:"Dealer enquiries and task routing"},
 {id:"jarvis",name:"JARVIS Brain Control",scope:"Approved tool requests and assistant workflows"},
 {id:"finance",name:"Savrdh Financial Services",scope:"Document follow-up and approval-gated operations"},
] as const;
const tasks=["Lead qualification","Customer follow-up","Create internal task","Draft customer response","Knowledge search","Human escalation"] as const;
export default function WorkforceControlCenter(){
 const [authenticated,setAuthenticated]=useState(false);
 const [ready,setReady]=useState(false);
 const [agents,setAgents]=useState<AgentRecord[]>([]);
 const [selected,setSelected]=useState("");
 const [product,setProduct]=useState<string>(products[0].id);
 const [task,setTask]=useState<string>(tasks[0]);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 useEffect(()=>{
  if(!crmSupabaseConfigured){setReady(true);return;}
  crmSupabase.auth.getSession().then(({data})=>{setAuthenticated(Boolean(data.session));setReady(true);}).catch(()=>setReady(true));
  const {data:listener}=crmSupabase.auth.onAuthStateChange((_event,session)=>{setAuthenticated(Boolean(session));if(!session){setAgents([]);setSelected("");}});
  return ()=>listener.subscription.unsubscribe();
 },[]);
 useEffect(()=>{
  if(!authenticated){setLoading(false);return;}
  let cancelled=false;setLoading(true);
  listAgents().then(data=>{if(!cancelled){setAgents(data.agents||[]);setSelected(prev=>prev||data.agents?.[0]?.id||"");}})
   .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"Could not load agents.")})
   .finally(()=>{if(!cancelled)setLoading(false)});
  return ()=>{cancelled=true};
 },[authenticated]);
 const current=useMemo(()=>agents.find(a=>a.id===selected),[agents,selected]);
 const target=products.find(x=>x.id===product);
 return <main style={{minHeight:"100vh",background:"#08121d",color:"#e7f5f8",padding:"clamp(16px,3vw,36px)"}}>
  <header style={{display:"flex",gap:16,justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",marginBottom:24}}>
   <div><small style={{color:"#69e0d3",letterSpacing:2}}>SAVRDH AI OS · COMMAND CENTER</small><h1 style={{fontSize:"clamp(25px,3vw,38px)",margin:"7px 0"}}>AI Workforce Control Center</h1><p style={{color:"#9db6c4",margin:0}}>Select an AI agent, define its product and work scope, then configure approval-gated integration.</p></div>
   <Link href="/crm" style={{color:"#7de6d4"}}>Back to AI OS</Link>
  </header>
  {!ready?<p>Checking access…</p>:!crmSupabaseConfigured?<p role="alert">Supabase configuration required.</p>:!authenticated?<p>Sign in through <Link href="/crm" style={{color:"#7de6d4"}}>Savrdh AI OS</Link> to view your agent registry.</p>:<>
    <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,260px),1fr))",gap:13,marginBottom:24}}>
     {[[Bot,"AI Agent Registry",String(agents.length),"Existing database agents"],[Boxes,"Product Targets",String(products.length),"Candidate adapters; not connected"],[Workflow,"Workflow Studio","Open","Design and test actions"],[ShieldCheck,"Execution Policy","Approval","No cross-product write without grant"]].map(([Icon,label,value,description])=><div key={String(label)} style={{padding:18,border:"1px solid #284152",background:"#101f2d",borderRadius:14}}><Icon size={21} color="#5bd8c7"/><h2 style={{fontSize:15,margin:"10px 0 5px"}}>{String(label)}</h2><strong style={{fontSize:22}}>{String(value)}</strong><p style={{color:"#91adbc",fontSize:12,margin:"5px 0"}}>{String(description)}</p></div>)}
    </section>
    {error&&<p role="alert" style={{color:"#ffb5aa"}}>{error}</p>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,360px),1fr))",gap:18}}>
     <section style={{border:"1px solid #2c4758",background:"#112332",borderRadius:14,padding:18}}>
      <h2 style={{fontSize:18}}>1. Choose AI Agent</h2><p style={{color:"#99b0c0",fontSize:13}}>Loaded from the existing authenticated SAVRDH agent registry.</p>
      {loading?<p>Loading agents…</p>:<div style={{display:"grid",gap:9}}>
      {agents.map(agent=><button key={agent.id} onClick={()=>setSelected(agent.id)} aria-pressed={selected===agent.id} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:13,textAlign:"left",cursor:"pointer",color:"#e8f5fc",background:selected===agent.id?"#1c4b50":"#192b3b",border:selected===agent.id?"1px solid #60dccb":"1px solid #334e5f",borderRadius:9}}>
       <Bot size={18} color="#69e1d0"/><span style={{flex:1}}><b style={{display:"block"}}>{agent.display_name||agent.name}</b><small style={{color:"#b6c8d4"}}>{agent.role_name}</small></span><small>{agent.status}</small>
      </button>)}
      {!agents.length&&<p>No agents available for this account.</p>}
      </div>}
      {current&&<Link href={`/crm/agents/${encodeURIComponent(current.id)}`} style={{display:"inline-flex",gap:7,alignItems:"center",color:"#7debd8",marginTop:16}}>Manage selected agent <ExternalLink size={13}/></Link>}
     </section>
     <section style={{border:"1px solid #2c4758",background:"#112332",borderRadius:14,padding:18}}>
      <h2 style={{fontSize:18}}>2. Define Product Assignment</h2>
      <p style={{color:"#99b0c0",fontSize:13}}>Assignment design preview. Saving and executing require a secured product-connector backend.</p>
      <label style={{display:"grid",gap:7,marginBottom:15}}>Product
       <select value={product} onChange={e=>setProduct(e.target.value)} style={{background:"#0d1b28",color:"white",border:"1px solid #426072",padding:12,borderRadius:9}}>{products.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label style={{display:"grid",gap:7,marginBottom:15}}>Proposed agent task
       <select value={task} onChange={e=>setTask(e.target.value)} style={{background:"#0d1b28",color:"white",border:"1px solid #426072",padding:12,borderRadius:9}}>{tasks.map(x=><option key={x}>{x}</option>)}</select></label>
      <div style={{padding:15,background:"#0c1a26",borderRadius:10,border:"1px solid #2c4758"}}>
       <div style={{display:"flex",gap:7,alignItems:"center",color:"#60d7c7",fontSize:12,marginBottom:8}}><Activity size={14}/> ASSIGNMENT PREVIEW — NOT SAVED</div>
       <div><b>{current?.display_name||current?.name||"Select an agent"}</b> <ArrowRight size={12} style={{display:"inline"}}/> <b>{target?.name}</b></div>
       <p style={{color:"#a8bfca",fontSize:13}}>{task} · {target?.scope}</p>
       <p style={{color:"#ffca91",fontSize:12}}>Connection status: not configured. No customer data is shared and no task is sent.</p>
      </div>
      <Link href="/crm/agent-studio" style={{display:"inline-flex",gap:7,alignItems:"center",color:"#8ae9d7",marginTop:17}}>Open Visual Workflow Studio <ArrowRight size={15}/></Link>
     </section>
    </div>
  </>}
 </main>;
}
