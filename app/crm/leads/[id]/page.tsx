"use client";
import { crmFetch } from "../../request";


import { useEffect,useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft,Bot,Mail,ListTodo,Network,RefreshCw } from "lucide-react";
import { crmSupabase } from "../../supabase-client";
import "../../crm.css";

function obj(v:unknown):Record<string,any>{return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,any>:{};}
function when(v?:string|null){return v?new Date(v).toLocaleString("en-IN"):"—";}

export default function LeadSalesDetailPage(){
  const params=useParams<{id:string}>();
  const [data,setData]=useState<Record<string,any>|null>(null);
  const [agents,setAgents]=useState<any[]>([]);
  const [products,setProducts]=useState<any[]>([]);
  const [productId,setProductId]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  async function load(){
    setBusy(true);
    try{
    const [detail,agentRows,productRows]=await Promise.all([
      crmSupabase.rpc("sav_ai_crm_lead_sales_detail",{p_lead_id:params.id}),
      crmSupabase.rpc("sav_ai_crm_agents"),crmSupabase.rpc("sav_ai_crm_active_products")
    ]);
    for(const r of [detail,agentRows,productRows])if(r.error)throw new Error(r.error.message);
    setData(obj(detail.data));setAgents(agentRows.data||[]);setProducts(productRows.data||[]);
    }catch(e){setMessage(e instanceof Error?e.message:"Lead could not be loaded.");}finally{setBusy(false);}
  }

  useEffect(()=>{load();},[params.id]);

  async function generateDraft(){
    if(busy)return;
    const agent=agents.find((a)=>a.slug==="sav-sales"||a.name==="SAV-Sales");
    if(!agent){setMessage("SAV-Sales agent is not available.");return;}
    const {data:session}=await crmSupabase.auth.getSession();
    const token=session.session?.access_token;
    if(!token){setMessage("Authentication required.");return;}
    setBusy(true); setMessage("");
    try{
    const res=await crmFetch("/api/sales/email-drafts",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({leadId:params.id,agentId:agent.id,productId:productId||undefined})});
    const body=await res.json().catch(()=>({}));
    setBusy(false);
    setMessage(body.message||body.error||(res.ok?"Email draft generated.":"Unable to generate email draft."));
    if(res.ok)await load();
    }catch{setMessage("Network unavailable. Refresh to check the saved result before retrying.");}finally{setBusy(false);}
  }

  async function approveSend(id:string){
    if(busy)return;
    const {data:session}=await crmSupabase.auth.getSession();
    const token=session.session?.access_token;
    if(!token){setMessage("Authentication required.");return;}
    setBusy(true); setMessage("");
    try{
    const res=await crmFetch(`/api/sales/email-drafts/${id}/approve-send`,{method:"POST",headers:{Authorization:`Bearer ${token}`}});
    const body=await res.json().catch(()=>({}));
    setBusy(false);
    setMessage(body?.send?.message||body.message||body.error||(res.ok?"Email sent.":"Email send unavailable."));
    if(res.ok)await load();
    }catch{setMessage("Network unavailable. Refresh to check the saved result before retrying.");}finally{setBusy(false);}
  }

  if(!data) return <div className="crm-auth-page"><div className="crm-auth-card"><p>{busy?"Loading lead...":message||"Lead not found."}</p></div></div>;

  const lead=obj(data.lead);
  const emails=Array.isArray(data.emails)?data.emails:[];
  const activities=Array.isArray(data.activities)?data.activities:[];
  const tasks=Array.isArray(data.tasks)?data.tasks:[];

  return <div className="crm-shell crm-detail-shell">
    <main className="crm-main crm-detail-main">
      <header className="crm-topbar">
        <div className="crm-title-wrap"><small>SAV AI SALES WORKFLOW</small><h1>{lead.title||"Lead Detail"}</h1></div>
        <div className="crm-top-actions">
          <a className="crm-back-link" href="/crm"><ArrowLeft size={14}/> CRM</a>
          <button onClick={load} disabled={busy}><RefreshCw size={13}/> Refresh</button>
        </div>
      </header>
      <div className="crm-content">
        {message&&<div className="crm-panel crm-inline-message">{message}</div>}
        <div className="crm-dashboard-grid">
          <section className="crm-panel">
            <div className="crm-panel-head"><h3>Lead Source</h3><Network size={16}/></div>
            <div className="crm-detail-list">
              <div><span>Source</span><b className="crm-badge engagex"><i/> {lead.source==="engagex"?"ENGAGEX":lead.source}</b></div>
              <div><span>Name</span><b>{lead.title||"—"}</b></div>
              <div><span>Email</span><b>{lead.email||"—"}</b></div>
              <div><span>Phone</span><b>{lead.phone||"—"}</b></div>
              <div><span>Company</span><b>{lead.company||"—"}</b></div>
              <div><span>Industry</span><b>{lead.industry||"—"}</b></div>
              <div><span>Website</span><b>{lead.website||"—"}</b></div>
            </div>
          </section>

          <section className="crm-panel">
            <div className="crm-panel-head"><h3>AI Analysis</h3><Bot size={16}/></div>
            <div className="crm-detail-list">
              <div><span>Qualification</span><b>{lead.ai_qualification||"Not analyzed"}</b></div>
              <div><span>Lead Score</span><b>{lead.score??0}</b></div>
              <div><span>Confidence</span><b>{lead.ai_confidence==null?"—":Math.round(Number(lead.ai_confidence)*100)+"%"}</b></div>
              <div className="full"><span>Reasoning</span><b>{lead.ai_reasoning||"No AI analysis yet."}</b></div>
            </div>
          </section>
        </div>

        <section className="crm-panel">
          <div className="crm-panel-head"><div><h3>Email</h3><span>Draft → Approve & Send</span></div><button className="primary" onClick={generateDraft} disabled={busy}><Mail size={13}/> Generate Draft</button></div>
          <label className="crm-detail-list">Approved product / service<select value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Use saved recommendation</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{!products.length&&<p>No active approved products are configured. Use the agent console to create a qualification task; no product or pricing will be invented.</p>}
          {emails.length?<div className="crm-activity-list">{emails.map((e:any)=><div className="crm-email-card" key={e.id}>
            <div><b>{e.subject}</b><span>{e.recipient} · {e.status.toUpperCase()} · {when(e.created_at)}</span><p>{e.body}</p></div>
            {e.status!=="sent"&&<button onClick={()=>approveSend(e.id)} disabled={busy}>Approve & Send</button>}
          </div>)}</div>:<div className="crm-activity"><i/><div><b>No email draft</b><span>SAV-Sales can generate a draft after supported product fit and email consent are available.</span></div></div>}
        </section>

        <div className="crm-dashboard-grid">
          <section className="crm-panel">
            <div className="crm-panel-head"><h3>AI Activity Timeline</h3><span>{activities.length} events</span></div>
            <div className="crm-activity-list">{activities.map((a:any)=><div className="crm-activity" key={a.id}><i/><div><b>{a.title}</b><span>{a.description||a.activity_type}</span></div><time>{when(a.created_at)}</time></div>)}</div>
          </section>
          <section className="crm-panel">
            <div className="crm-panel-head"><h3>Tasks</h3><ListTodo size={16}/></div>
            <div className="crm-activity-list">{tasks.map((t:any)=><div className="crm-activity" key={t.id}><i/><div><b>{t.title}</b><span>{t.status} · {t.priority}</span></div><time>{when(t.due_at)}</time></div>)}</div>
          </section>
        </div>
      </div>
    </main>
  </div>;
}
