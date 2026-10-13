"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Bot, Plus, RefreshCw, ShieldCheck, TestTube2 } from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "../supabase-client";
import { createAgent, listAgents } from "../agents/agent-service";
import type { AgentRecord } from "../agents/agent-types";
import "../crm.css";
import "./factory.css";

const starterRoles = [
 {role:"Sales & Lead Qualification",name:"SAV-Sales",description:"Qualify incoming leads and prepare recommended follow-up tasks for human review."},
 {role:"Customer Follow-up",name:"SAV-Followup",description:"Review pending follow-up tasks, suggest next steps and route approvals."},
 {role:"Finance Documentation",name:"SAV-Finance",description:"Review document completeness without sanctioning, paying or changing verified financial transactions."},
 {role:"Customer Support",name:"SAV-Support",description:"Answer questions from approved knowledge and escalate unknown or sensitive cases."},
 {role:"Marketing Coordination",name:"SAV-Marketing",description:"Draft campaign content for human approval; no automatic bulk sending."},
 {role:"Business Development",name:"SAV-BDE",description:"Qualify partner opportunities and create internal task suggestions."}
] as const;

export default function AgentFactoryPage(){
 const [ready,setReady]=useState(false),[authed,setAuthed]=useState(false);
 const [agents,setAgents]=useState<AgentRecord[]>([]);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(""),[success,setSuccess]=useState("");
 const [role,setRole]=useState<string>(starterRoles[0].role);
 const [name,setName]=useState<string>(starterRoles[0].name);
 const [description,setDescription]=useState<string>(starterRoles[0].description);
 const [slug,setSlug]=useState("sav-sales");
 useEffect(()=>{
  if(!crmSupabaseConfigured){setReady(true);return;}
  crmSupabase.auth.getSession().then(({data})=>{setAuthed(Boolean(data.session));setReady(true);}).catch(()=>setReady(true));
  const {data:listener}=crmSupabase.auth.onAuthStateChange((_event,session)=>{setAuthed(Boolean(session));if(!session)setAgents([])});
  return ()=>listener.subscription.unsubscribe();
 },[]);
 async function refresh(){
  if(!authed)return;setLoading(true);setError("");
  try{const data=await listAgents();setAgents(data.agents||[]);}
  catch(e){setError(e instanceof Error?e.message:"Cannot load agent registry.");}
  finally{setLoading(false);}
 }
 useEffect(()=>{if(authed)void refresh()},[authed]);
 function chooseRole(value:string){
  const template=starterRoles.find(r=>r.role===value);
  setRole(value);
  if(template){setName(template.name);setDescription(template.description);setSlug(template.name.toLowerCase().replace(/[^a-z0-9]+/g,"-"));}
 }
 async function create(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setError("");setSuccess("");
  const validSlug=/^[a-z][a-z0-9-]{2,63}$/.test(slug);
  if(!validSlug){setError("Slug must have 3–64 characters: lowercase letters, digits and hyphens.");return;}
  if(name.trim().length<3||description.trim().length<10){setError("Enter an agent name and a meaningful description.");return;}
  if(agents.some(a=>a.slug===slug)){setError("An agent with this slug already exists.");return;}
  setBusy(true);
  try{
   const created=await createAgent({name:name.trim(),slug,role_name:role,description:description.trim()});
   setSuccess("Agent registered. Review its permissions and execution settings before activation.");
   await refresh();
   if(created?.id)setSuccess("Agent registered. Open its configuration before testing or activation.");
  }catch(err){setError(err instanceof Error?err.message:"Agent creation failed.")}
  finally{setBusy(false)}
 }
 return <main className="ai-factory">
  <header className="ai-factory-header"><div><small>SAVRDH AI OS · AGENT DEVELOPMENT</small><h1>AI Agent Factory</h1><p>Create dedicated AI employees, configure their responsibilities, and test them before assigning them to other products.</p></div><Link href="/crm">Back to AI OS</Link></header>
  {!ready?<p>Checking session…</p>:!crmSupabaseConfigured?<p role="alert">Supabase environment configuration required for this preview.</p>:!authed?<p><Link href="/crm">Sign in to Savrdh AI OS</Link> to create agents.</p>:<div className="ai-factory-grid">
   <section className="ai-factory-panel"><h2><Plus size={19}/> Develop new AI Agent</h2><p>Select a starter role, customize its name and responsibilities. The existing authenticated server API controls creation.</p>
    <form onSubmit={create}>
     <label>Agent role<select value={role} onChange={e=>chooseRole(e.target.value)}>{starterRoles.map(t=><option key={t.role} value={t.role}>{t.role}</option>)}</select></label>
     <label>Employee name<input required minLength={3} maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label>
     <label>Unique ID / slug<input required pattern="[a-z][a-z0-9-]{2,63}" value={slug} onChange={e=>setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,""))}/></label>
     <label>Responsibilities<textarea required minLength={10} rows={5} value={description} onChange={e=>setDescription(e.target.value)}/></label>
     <p className="ai-factory-notice"><ShieldCheck size={16}/> This creates an agent registry entry, not a live connected autonomous worker. Review capabilities, provider and approval rules first.</p>
     {error&&<p role="alert" className="ai-factory-error">{error}</p>}{success&&<p role="status" className="ai-factory-success">{success}</p>}
     <button type="submit" disabled={busy}>{busy?"Creating…":"Create Agent"}</button>
    </form>
   </section>
   <section className="ai-factory-panel"><div className="ai-factory-list-head"><h2><Bot size={19}/> Existing AI Agents</h2><button onClick={refresh} disabled={loading} title="Refresh agents"><RefreshCw size={16}/></button></div>
    <p>Real records from the SAVRDH AI OS registry. Status does not guarantee working external integration.</p>
    {loading?<p>Loading agents…</p>:agents.length===0?<p>No agents registered yet.</p>:<div className="ai-factory-list">{agents.map(agent=><article key={agent.id}><div><b>{agent.display_name||agent.name}</b><small>{agent.role_name} · {agent.status}</small></div><Link href={`/crm/agents/${encodeURIComponent(agent.id)}`}>Configure</Link></article>)}</div>}
    <div className="ai-factory-next"><h3><TestTube2 size={17}/> Recommended setup</h3><p>1. Create agent → 2. Configure instructions & access → 3. Plan test on synthetic context → 4. Approve product connector → 5. Enable monitored execution.</p><Link href="/crm/agent-studio">Open Workflow Studio →</Link></div>
   </section>
  </div>}
 </main>;
}
