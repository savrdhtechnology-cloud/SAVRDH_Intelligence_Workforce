"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, BarChart3, Bell, Bot, BrainCircuit, CheckCircle2, ChevronDown, ClipboardCheck, Database, ExternalLink, FileText, GitBranch, LayoutDashboard, LockKeyhole, Network, Pause, Plus, Search, Settings2, ShieldCheck, TestTube2, Workflow, X } from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "../crm/supabase-client";
import "./admin.css";
import AdminProductRegistry from "./AdminProductRegistry";

type Section = "overview"|"factory"|"library"|"assignments"|"workflows"|"testing"|"executions"|"integrations"|"knowledge"|"approvals"|"analytics"|"settings";
type Module = {id:Section; name:string; subtitle:string; icon:typeof Bot; href?:string};
const modules:Module[]=[
 {id:"overview",name:"Command Dashboard",subtitle:"Operations overview",icon:LayoutDashboard},
 {id:"factory",name:"Agent Factory",subtitle:"Develop AI employees",icon:Plus},
 {id:"library",name:"Agent Library",subtitle:"Manage agents & roles",icon:Bot,href:"/crm/agents"},
 {id:"assignments",name:"Product Assignments",subtitle:"Assign agents by system",icon:GitBranch,href:"/crm/workforce"},
 {id:"workflows",name:"Workflow Studio",subtitle:"Visual automations",icon:Workflow,href:"/crm/agent-studio"},
 {id:"testing",name:"Testing Lab",subtitle:"Dry runs & scenarios",icon:TestTube2,href:"/crm/agent-studio"},
 {id:"executions",name:"Execution Monitor",subtitle:"Run logs & debugging",icon:Activity,href:"/crm/agent-studio/debug"},
 {id:"integrations",name:"Product Integrations",subtitle:"Connection registry",icon:Network},
 {id:"knowledge",name:"Knowledge & Memory",subtitle:"Documents & context",icon:Database},
 {id:"approvals",name:"Human Approvals",subtitle:"Sensitive action review",icon:ClipboardCheck},
 {id:"analytics",name:"Analytics & Reports",subtitle:"Workforce performance",icon:BarChart3},
 {id:"settings",name:"Admin Settings",subtitle:"Permissions & policy",icon:Settings2}
];
const products=["Savrdh Technology CRM","EngageX Marketing CRM","Savrdh AutoOS","JARVIS Brain Control","Savrdh Financial Services","Other Products"];
const roles=["Sales Agent","Follow-up Agent","Finance Agent","Support Agent","Marketing Agent","BDE Agent","Custom Agent"];
const presets=[
 {name:"SAV-Sales",role:"Lead qualification",desc:"Qualify leads and propose human-reviewed follow-up tasks"},
 {name:"SAV-Followup",role:"Customer follow-up",desc:"Plan reminders and internal next actions"},
 {name:"SAV-Finance",role:"Financial documentation",desc:"Check document completeness without moving money"},
 {name:"SAV-Support",role:"Customer support",desc:"Answer from approved knowledge and escalate"},
 {name:"SAV-Marketing",role:"Campaign preparation",desc:"Prepare campaign drafts for review"},
 {name:"SAV-BDE",role:"Business development",desc:"Triage partnerships and create action recommendations"}
];

export default function AdminWorkspace(){
 const [current,setCurrent]=useState<Section>("overview");
 const [query,setQuery]=useState("");
 const [sidebar,setSidebar]=useState(true);
 const [authenticated,setAuthenticated]=useState(false);
 const [ready,setReady]=useState(false);
 const [draftName,setDraftName]=useState("SAV-Sales");
 const [draftRole,setDraftRole]=useState("Sales Agent");
 const [draftInstructions,setDraftInstructions]=useState(presets[0].desc);
 const [draftProduct,setDraftProduct]=useState(products[0]);
 const [draftAgent,setDraftAgent]=useState("SAV-Sales");
 const [draftSearch,setDraftSearch]=useState("");
 useEffect(()=>{
  if(!crmSupabaseConfigured){setReady(true);return;}
  crmSupabase.auth.getSession().then(({data})=>{setAuthenticated(Boolean(data.session));setReady(true)}).catch(()=>setReady(true));
  const {data:listener}=crmSupabase.auth.onAuthStateChange((_event,session)=>setAuthenticated(Boolean(session)));
  return ()=>listener.subscription.unsubscribe();
 },[]);
 const active=modules.find(m=>m.id===current)||modules[0];
 const filtered=useMemo(()=>modules.filter(m=>m.name.toLowerCase().includes(query.toLowerCase())),[query]);
 const chosenPreset=presets.filter(p=>p.name.toLowerCase().includes(draftSearch.toLowerCase()));
 return <div className="savos-root">
   <aside className={"savos-sidebar "+(!sidebar?"compact":"")}>
    <div className="savos-brand"><div className="savos-logo"><BrainCircuit size={23}/></div>{sidebar&&<div><strong>SAVRDH AI OS</strong><small>WORKFORCE / ADMIN</small></div>}</div>
    <div className="savos-side-inner">{sidebar&&<><small className="savos-nav-heading">WORKSPACE</small><div className="savos-search"><Search size={15}/><input aria-label="Search admin modules" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search modules"/></div></>}
    <nav aria-label="AI Workforce Admin">
     {filtered.map(m=><button key={m.id} className={current===m.id?"selected":""} title={m.name} onClick={()=>setCurrent(m.id)}><m.icon size={18}/>{sidebar&&<span>{m.name}</span>}{sidebar&&current===m.id&&<span className="savos-active-dot"/>}</button>)}
    </nav></div>
    <div className="savos-side-bottom"><button onClick={()=>setSidebar(v=>!v)} title="Collapse sidebar"><ChevronDown size={16}/>{sidebar&&"Collapse menu"}</button>{sidebar&&<span>Developed by SAVRDH Technologies</span>}</div>
   </aside>
   <main className="savos-main">
    <header className="savos-top"><div><small>SAVRDH / AI WORKFORCE / ADMIN</small><h1>{active.name}</h1></div><div className="savos-top-actions"><span className="savos-status"><i/> Admin UI Preview</span><Link href="/crm"><ExternalLink size={14}/> Open AI OS</Link></div></header>
    {!ready?<div className="savos-auth">Checking authentication…</div>:!crmSupabaseConfigured?<div className="savos-auth"><LockKeyhole size={22}/><h2>Configuration required</h2><p>Connect the existing Supabase environment to access the Admin workspace. The UI remains visible below as a design preview.</p></div>:!authenticated?<div className="savos-auth"><LockKeyhole size={22}/><h2>Sign in required</h2><p>Administrative actions require an authenticated Savrdh AI OS session.</p><Link href="/crm">Open AI OS Login →</Link></div>:<div className="savos-auth-note"><ShieldCheck size={15}/> Authenticated workspace · Demo controls never execute external customer actions</div>}
    <div className="savos-content">
    {current==="overview"&&<>
     <div className="savos-hero"><div><small>AI WORKFORCE CONTROL CENTER</small><h2>Build, assign and supervise your AI team.</h2><p>One admin workspace to develop agents, connect approved products, test workflows and review execution. This is the UI phase; no sample metric is represented as real production data.</p><button onClick={()=>setCurrent("factory")}><Plus size={17}/> Develop AI Agent</button></div><div className="savos-orbit"><BrainCircuit size={65}/><span>AGENT CONTROL</span></div></div>
     <div className="savos-card-grid">{modules.filter(m=>m.id!=="overview").map(m=><button key={m.id} className="savos-module-card" onClick={()=>setCurrent(m.id)}><div className="savos-module-icon"><m.icon size={19}/></div><strong>{m.name}</strong><p>{m.subtitle}</p><ArrowRight size={16}/></button>)}</div>
    </>}
    {current==="factory"&&<div className="savos-split">
     <section className="savos-panel"><div className="savos-section-title"><div><small>AGENT DEVELOPMENT</small><h2>Create AI Employee</h2></div><span className="savos-tag">Draft UI</span></div><p>Define the employee before provisioning its AI model, permissions, knowledge and product connectors.</p>
      <label>Agent Name<input value={draftName} onChange={e=>setDraftName(e.target.value)}/></label>
      <label>Agent Role<select value={draftRole} onChange={e=>setDraftRole(e.target.value)}>{roles.map(r=><option key={r}>{r}</option>)}</select></label>
      <label>Agent Instructions<textarea value={draftInstructions} onChange={e=>setDraftInstructions(e.target.value)} rows={5}/></label>
      <div className="savos-hint"><ShieldCheck size={16}/> This form is a configuration preview. No agent is created until the real backend is connected and permissions are checked.</div>
      <Link className="savos-link-action" href="/crm/agents">Open existing Agent Registry <ArrowRight size={15}/></Link>
     </section>
     <section className="savos-panel"><div className="savos-section-title"><div><small>STARTER ROLES</small><h2>AI Employee Templates</h2></div></div><div className="savos-search savos-inline-search"><Search size={14}/><input value={draftSearch} onChange={e=>setDraftSearch(e.target.value)} placeholder="Find a template"/></div><div className="savos-preset-list">{chosenPreset.map(p=><button key={p.name} onClick={()=>{setDraftName(p.name);setDraftInstructions(p.desc);setDraftRole(roles.find(r=>p.name.toLowerCase().includes(r.split(" ")[0].toLowerCase()))||"Custom Agent")}}><Bot size={19}/><span><strong>{p.name}</strong><small>{p.role}</small></span><Plus size={15}/></button>)}</div></section>
    </div>}
    {current==="assignments"&&<div className="savos-split"><section className="savos-panel"><div className="savos-section-title"><div><small>PRODUCT MAPPING</small><h2>Agent Assignment Planner</h2></div><span className="savos-tag">Draft UI</span></div><label>Choose Agent<select value={draftAgent} onChange={e=>setDraftAgent(e.target.value)}>{presets.map(p=><option key={p.name}>{p.name}</option>)}</select></label><label>Assign to Product<select value={draftProduct} onChange={e=>setDraftProduct(e.target.value)}>{products.map(p=><option key={p}>{p}</option>)}</select></label><div className="savos-assignment"><Bot size={25}/><strong>{draftAgent}</strong><ArrowRight size={21}/><Network size={25}/><strong>{draftProduct}</strong></div><p>No assignment saved or external product connected by this preview.</p><Link className="savos-link-action" href="/crm/workforce">Open existing Assignment Planner <ArrowRight size={15}/></Link></section><section className="savos-panel"><h2>Product Connection Strategy</h2><p>Every product needs scoped credentials, a verified tenant, action allowlist, consent and audit logging.</p><div className="savos-item-list">{products.map(p=><div key={p}><Network size={17}/><span>{p}</span><em>Not verified</em></div>)}</div></section></div>}
    {current==="library"&&<ResourceModule title="AI Agent Library" description="Inspect actual agent configurations, permissions, status, working hours and activity through the existing module." href="/crm/agents" action="Manage AI Agents" icon={Bot}/>}
    {current==="workflows"&&<ResourceModule title="Visual Workflow Editor" description="Use the current node canvas to arrange triggers, AI agents, approvals and tools." href="/crm/agent-studio" action="Open Workflow Studio" icon={Workflow}/>}
    {current==="testing"&&<ResourceModule title="Agent Testing Lab" description="Plan and test sample lead scenarios before activating real actions. Single-node replay remains planned." href="/crm/agent-studio" action="Open Test Workspace" icon={TestTube2}/>}
    {current==="executions"&&<ResourceModule title="Execution Monitor" description="Inspect saved execution history, status, errors and read-only redacted step logs." href="/crm/agent-studio/debug" action="Open Debug Console" icon={Activity}/>}
    {current==="integrations"&&<><AdminProductRegistry/><div className="savos-panel"><h2>Product Connector Registry</h2><p>Choose a Savrdh product for future authentication, scoped actions and health monitoring. The displayed connections are placeholders, not live integrations.</p><div className="savos-connectors">{products.map(p=><div key={p}><Network size={22}/><strong>{p}</strong><span>Setup pending</span></div>)}</div></div></>}
    {current==="knowledge"&&<div className="savos-panel"><h2>Knowledge & Memory Center</h2><p>Planned: approved documents, per-agent access scopes, file versioning, citations, retention policies and controlled conversation memory.</p><div className="savos-empty"><Database size={30}/><b>No knowledge sources loaded in this Admin UI</b><small>Connect the existing knowledge backend before enabling uploads or search.</small></div></div>}
    {current==="approvals"&&<div className="savos-panel"><h2>Human Approval Desk</h2><p>High-risk messages, financial actions, permissions and customer-facing steps require server-enforced approval before execution.</p><div className="savos-empty"><ClipboardCheck size={30}/><b>Use the live Agent approval queue</b><small>This UI does not invent approvals or modify sensitive actions.</small><Link href="/crm/agents">Open Agent Approvals <ArrowRight size={15}/></Link></div></div>}
    {current==="analytics"&&<div className="savos-panel"><h2>Analytics & Reports</h2><p>Planned dashboards: success rate, agent throughput, costs, task completion and product-wise utilization. No fabricated numbers displayed.</p><div className="savos-empty"><BarChart3 size={30}/><b>Verified reporting will use real execution data</b></div></div>}
    {current==="settings"&&<div className="savos-panel"><h2>Admin Policies</h2><div className="savos-item-list">{["Role-based access","Product / tenant isolation","Human approval controls","Model & provider configuration","Credential management","Audit logs and data retention"].map(k=><div key={k}><ShieldCheck size={16}/>{k}<em>Backend controls required</em></div>)}</div></div>}
    </div>
    <footer>© SAVRDH Technologies · AI OS Admin Workspace · UI-only preview, existing services preserved</footer>
   </main>
 </div>;
}
function ResourceModule({title,description,href,action,icon:Icon}:{title:string;description:string;href:string;action:string;icon:typeof Bot}){
 return <div className="savos-panel savos-resource"><div className="savos-resource-icon"><Icon size={34}/></div><h2>{title}</h2><p>{description}</p><Link className="savos-link-action" href={href}>{action}<ArrowRight size={16}/></Link></div>;
}
