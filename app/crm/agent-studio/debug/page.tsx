"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, Copy, RefreshCcw, ShieldCheck } from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "../../supabase-client";
import { getWorkflow, listWorkflows } from "../../workflows/workflow-service";
import type { WorkflowRecord } from "../../workflows/workflow-types";

type Log = { node_key?: string; status?: string; started_at?: string; completed_at?: string; error?: string | null; [key: string]: unknown };
type Execution = { id: string; execution_state?: string; context?: Record<string, unknown>; trigger?: string; updated_at?: string; error?: string | null };

function redact(value: unknown, key = "", depth = 0): unknown {
  if (/password|token|secret|authorization|api.?key|cookie|session|private.?key|access.?key/i.test(key)) return "[REDACTED]";
  if (depth > 12) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 100).map(v => redact(v, "", depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 100).map(([k,v]) => [k, redact(v, k, depth + 1)]));
  if (typeof value === "string") return value.length > 4000 ? value.slice(0, 4000) + "…" : value;
  return value;
}
function safeJson(value: unknown) { return JSON.stringify(redact(value), null, 2); }

export default function StudioDebugger() {
  const [authenticated, setAuthenticated] = useState(false);
  const [ready, setReady] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [chosen, setChosen] = useState("");
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!crmSupabaseConfigured) { setReady(true); return; }
    crmSupabase.auth.getSession().then(({data}) => {
      setAuthenticated(Boolean(data.session));
      setReady(true);
    }).catch(() => { setReady(true); });
    const {data: listener} = crmSupabase.auth.onAuthStateChange((_event,session) => {
      setAuthenticated(Boolean(session));
      if (!session) { setWorkflows([]); setExecutions([]); setLogs([]); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    listWorkflows().then(r => {
      if (!cancelled) { setWorkflows(r.workflows || []); setChosen(c => c || r.workflows?.[0]?.id || ""); }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load workflows"); });
    return () => { cancelled = true; };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !chosen) return;
    let cancelled = false;
    setLoading(true); setError(""); setExecutions([]); setLogs([]); setSelected("");
    getWorkflow(chosen).then(result => {
      if (cancelled) return;
      const rows = (result.executions || []) as Execution[];
      setExecutions(rows);
      setSelected(rows[0]?.id || "");
      setLogs((result.latest_node_executions || []) as Log[]);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load executions"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chosen, authenticated]);

  const execution = executions.find(x => x.id === selected);
  const latest = executions[0]?.id === selected;
  return <main style={{background:"#0b121c", color:"#e6f2f5", minHeight:"100vh", padding:"24px max(18px,4vw)",fontFamily:"inherit"}}>
    <header style={{display:"flex",gap:16,justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",marginBottom:24}}>
      <div><div style={{color:"#61dbc5",fontSize:11,letterSpacing:2}}>SAVRDH AI OS · OBSERVABILITY</div><h1 style={{margin:"6px 0",fontSize:28}}>Workflow Debugger</h1><p style={{color:"#8da5b5",margin:0,fontSize:13}}>Review previous executions safely. No external actions are run here.</p></div>
      <Link href="/crm/agent-studio" style={{color:"#8ce9db"}}>Back to Agent Studio</Link>
    </header>
    {!ready?<p>Checking session…</p>:!crmSupabaseConfigured?<p role="alert">AI OS configuration required.</p>:!authenticated?<section><AlertCircle size={24}/><h2>Sign-in required</h2><Link href="/crm">Open Savrdh AI OS Login</Link></section>:<>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:20}}>
        <label htmlFor="debug-workflow">Workflow</label><select id="debug-workflow" value={chosen} onChange={e=>setChosen(e.target.value)} style={{background:"#172433",color:"white",border:"1px solid #385066",padding:10,borderRadius:8,minWidth:230}}>
          {workflows.map(w=><option value={w.id} key={w.id}>{w.name}</option>)}
        </select>
        <span style={{color:"#85b5a9",fontSize:12,display:"flex",alignItems:"center",gap:5}}><ShieldCheck size={14}/> Read-only debugging</span>
      </div>
      {error&&<p role="alert" style={{color:"#ff998c"}}>{error}</p>}
      {loading?<p>Loading executions…</p>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,320px),1fr))",gap:18}}>
        <section style={{background:"#16212e",border:"1px solid #304254",borderRadius:12,padding:16}}>
          <h2 style={{fontSize:16}}>Recent executions ({executions.length})</h2>
          {executions.length===0&&<p style={{color:"#91a4b6"}}>No execution history available.</p>}
          {executions.map(e=><button type="button" key={e.id} onClick={()=>setSelected(e.id)} aria-pressed={selected===e.id} style={{display:"block",width:"100%",textAlign:"left",cursor:"pointer",padding:12,marginBottom:7,background:selected===e.id?"#234c50":"#202e3c",color:"#e5f4fb",border:selected===e.id?"1px solid #65e2cc":"1px solid #35495a",borderRadius:9}}>
            <span style={{display:"flex",gap:8,alignItems:"center"}}>{e.execution_state==="completed"?<CheckCircle2 size={14} color="#65e2c2"/>:<Activity size={14}/>} {e.execution_state||"Unknown"}</span>
            <small style={{color:"#9eb5c6"}}>{e.trigger||"Event"} · {e.updated_at?new Date(e.updated_at).toLocaleString():""}</small>
          </button>)}
        </section>
        <section style={{background:"#16212e",border:"1px solid #304254",borderRadius:12,padding:16,minWidth:0}}>
          <h2 style={{fontSize:16}}>Execution inspection</h2>
          {execution?<><div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}><small style={{overflowWrap:"anywhere",color:"#9eb5c6"}}>{execution.id}</small><button type="button" onClick={()=>navigator.clipboard?.writeText(safeJson(execution.context||{}))} title="Copy redacted test data" style={{background:"#24433f",color:"#b1f8e9",padding:8,borderRadius:7,border:0,cursor:"pointer"}}><Copy size={15}/></button></div>
            <p style={{color:"#eeb478",fontSize:12}}>Data shown is redacted. Copying does not replay or execute a workflow.</p>
            <h3 style={{fontSize:13}}>Trigger context</h3><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:240,overflow:"auto",background:"#0c1723",padding:12,borderRadius:8}}>{safeJson(execution.context || {})}</pre>
            {execution.error&&<p role="alert" style={{color:"#ffb3a4"}}>{String(redact(execution.error))}</p>}
            <h3 style={{fontSize:13}}>Node logs {latest?"(latest execution only)":""}</h3>
            {!latest&&<p style={{fontSize:12,color:"#eec28b"}}>Per-node logs for older executions are not loaded by this endpoint. Select the latest execution to inspect node steps.</p>}
            {latest&&logs.map((log,i)=><details key={String(log.node_key||i)} style={{border:"1px solid #334858",borderRadius:9,padding:10,margin:"8px 0"}}><summary style={{cursor:"pointer",display:"flex",gap:10,alignItems:"center"}}><Activity size={13} color="#62d8c5"/>{log.node_key||"Node"} — {log.status||"unknown"}</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:220,overflow:"auto"}}>{safeJson(log)}</pre></details>)}
            {latest&&logs.length===0&&<p style={{color:"#8b9bab"}}>No node logs available.</p>}
          </>:<p style={{color:"#98aabb"}}>Choose an execution.</p>}
        </section>
      </div>}
    </>}
  </main>;
}
