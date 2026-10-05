"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  Contact,
  GitBranch,
  Inbox,
  LayoutDashboard,
  ListTodo,
  Loader2,
  LogOut,
  Network,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Users,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "./supabase-client";
import { LeadEditor, Opportunities, WorkspaceSettings, rpc } from "./Operations";
import TasksView from "./tasks/TasksView";
import AgentsModule from "./agents/AgentsModule";
import WorkflowsModule from "./workflows/WorkflowsModule";
import InboxModule from "./inbox/InboxModule";
import NotificationsModule from "./notifications/NotificationsModule";
import NotificationBell from "./notifications/NotificationBell";
import "./crm.css";

type View = "dashboard" | "leads" | "pipeline" | "agents" | "workflows" | "inbox" | "notifications" | "tasks" | "integrations" | "settings";

type Lead = {
  id: string;
  title: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  priority: string;
  score: number;
  value: number;
  next_followup_at: string | null;
  created_at: string;
  metadata?: {archived?: boolean};
};

const nav: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "leads", label: "Leads", icon: Users },
  { id: "pipeline", label: "Pipeline", icon: GitBranch },
  { id: "agents", label: "AI Agents", icon: Bot },
  { id: "workflows", label: "Workflows", icon: Workflow },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "integrations", label: "Integrations", icon: Network },
  { id: "settings", label: "Settings", icon: Settings },
];

const statuses = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost", "nurture"];

export default function CRMPage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authMessage, setAuthMessage] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [workspace, setWorkspace] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [leadModal, setLeadModal] = useState(false);
  const [search, setSearch] = useState("");
  const [leadStatus, setLeadStatus] = useState("");
  const [error,setError]=useState("");
  const [editingLead,setEditingLead]=useState<Lead|null>(null);
  const [refreshKey,setRefreshKey]=useState(0);

  useEffect(() => {
    const requested=new URLSearchParams(window.location.search).get('view')||window.location.pathname.split('/')[2];
    if(nav.some(n=>n.id===requested))setView(requested as View);
    if (!crmSupabaseConfigured) return;
    crmSupabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user.email || "";
      setUserEmail(email);
      setSessionReady(true);
      if (data.session) initCRM();
    });

    const { data: listener } = crmSupabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email || "");
      if (session) initCRM();
      else {
        setWorkspace(null);
        setDashboard(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function initCRM() {
    setLoading(true);
    try {
      const ws = await rpc("sav_ai_crm_workspace");
      if (!ws) {
        await rpc("sav_ai_crm_bootstrap_workspace", { p_company_name: "Savrdh Technology" });
      }
      await refreshAll();
    } catch(e){setError(e instanceof Error?e.message:"CRM initialization failed.");} finally {
      setLoading(false);
    }
  }

  async function refreshAll() {
    setLoading(true);setError("");
    try{
    const [ws, dash, leadRes, agentRes, integrationRes] = await Promise.all([
      crmSupabase.rpc("sav_ai_crm_workspace"),
      crmSupabase.rpc("sav_ai_crm_dashboard"),
      crmSupabase.rpc("sav_ai_crm_list_leads", { p_status: null, p_search: null }),
      crmSupabase.rpc("sav_ai_crm_agents"),
      crmSupabase.rpc("sav_ai_crm_integrations"),
    ]);
    for(const r of [ws,dash,leadRes,agentRes,integrationRes])if(r.error)throw new Error(r.error.message);
    setWorkspace(ws.data);
    setDashboard(dash.data);
    setLeads((leadRes.data || []) as Lead[]);
    setAgents(agentRes.data || []);
    setIntegrations(integrationRes.data || []);
    }catch(e){setError(e instanceof Error?e.message:"CRM refresh failed.");}finally{setLoading(false);}
  }

  async function handleAuth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthMessage("");
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || "");
    const password = String(fd.get("password") || "");
    if (!email || password.length < 6) {
      setAuthMessage("Enter a valid email and password of at least 6 characters.");
      return;
    }
    setLoading(true);
    const result = authMode === "login"
      ? await crmSupabase.auth.signInWithPassword({ email, password })
      : await crmSupabase.auth.signUp({ email, password });

    setLoading(false);
    if (result.error) setAuthMessage(result.error.message);
    else if (authMode === "signup" && !result.data.session) setAuthMessage("Account created. Check your email if confirmation is enabled.");
  }

  async function createLead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(loading)return;
    const fd = new FormData(e.currentTarget);
    setLoading(true);
    const { error } = await crmSupabase.rpc("sav_ai_crm_create_lead", {
      p_title: String(fd.get("title") || ""),
      p_company: String(fd.get("company") || "") || null,
      p_email: String(fd.get("email") || "") || null,
      p_phone: String(fd.get("phone") || "") || null,
      p_source: String(fd.get("source") || "manual"),
      p_priority: String(fd.get("priority") || "medium"),
      p_value: Number(fd.get("value") || 0),
    });
    setLoading(false);
    if(error){setError(error.message);return;}
    if (!error) {
      setLeadModal(false);
      await refreshAll();
    }
  }

  async function updateLeadStatus(id: string, status: string) {
    if(loading)return;setLoading(true);setError("");
    try{await rpc("sav_ai_crm_update_lead_status", { p_lead_id: id, p_status: status });await refreshAll();}
    catch(e){setError(e instanceof Error?e.message:"Status update failed.");}finally{setLoading(false);}
  }

  async function navigateCRM(nextView: View, status?: string) {
    if (nextView === "leads") {
      const nextStatus = status || "";
      setLeadStatus(nextStatus);
      setSearch("");
    }
    setView(nextView);
    window.history.replaceState(null,"",`/crm?view=${nextView}`);
  }

  async function logout() {
    await crmSupabase.auth.signOut();
  }

  const pipeline = useMemo(() => {
    const stages = ["new", "contacted", "qualified", "proposal", "negotiation"];
    return stages.map((stage) => ({ stage, items: leads.filter((l) => l.status === stage) }));
  }, [leads]);

  if (!crmSupabaseConfigured) return <div className="crm-auth-page"><div className="crm-auth-card" role="alert"><h2>CRM configuration required</h2><p>Supabase environment is not configured for this deployment.</p></div></div>;

  if (!sessionReady) return <div className="crm-auth-page" />;

  if (!userEmail) {
    return (
      <div className="crm-auth-page">
        <motion.section className="crm-auth-art" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className="crm-auth-copy">
            <span>SAVRDH INTELLIGENCE WORKFORCE</span>
            <h1>AI-native CRM.<br />Built to move work.</h1>
            <p>Manage leads, conversations, tasks, workflows and AI agents from one motion-driven command center. The CRM database is isolated in its own Savrdh Technology schema for clean future migration.</p>
          </div>
        </motion.section>

        <section className="crm-auth-panel">
          <motion.form className="crm-auth-card" onSubmit={handleAuth} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}>
            <h2>{authMode === "login" ? "Sign in to CRM" : "Create CRM account"}</h2>
            <p>Secure access to your SAV AI workspace.</p>
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label>Password<input name="password" type="password" minLength={6} autoComplete={authMode === "login" ? "current-password" : "new-password"} required /></label>
            <button disabled={loading}>{loading ? "Please wait..." : authMode === "login" ? "Sign In" : "Create Account"}</button>
            <button type="button" className="secondary" onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}>
              {authMode === "login" ? "Create new workspace account" : "Back to sign in"}
            </button>
            {authMessage && <div className="crm-auth-msg">{authMessage}</div>}
          </motion.form>
        </section>
      </div>
    );
  }

  return (
    <div className="crm-shell">
      <div className="crm-grid-bg" />
      <aside className="crm-sidebar">
        <div className="crm-brand">
          <div className="crm-brand-mark"><Sparkles size={16} /></div>
          <div><strong>SAVRDH AI</strong><span>INTELLIGENCE CRM</span></div>
        </div>

        <nav className="crm-nav">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => {setView(id);window.history.replaceState(null,"",`/crm?view=${id}`);}}>
              <Icon size={15} /> {label}<span className="nav-dot" />
            </button>
          ))}
        </nav>

        <div className="crm-sidebar-foot">
          <div className="crm-user">
            <b>{workspace?.company_name || "Savrdh Technology"}</b>
            <span>{userEmail}</span>
          </div>
          <button onClick={logout}><LogOut size={13} /> Sign out</button>
        </div>
      </aside>

      <main className="crm-main">
        <header className="crm-topbar">
          <div className="crm-title-wrap">
            <small>SAV AI COMMAND CENTER</small>
            <h1>{nav.find((x) => x.id === view)?.label}</h1>
          </div>
          <div className="crm-top-actions">
            <NotificationBell />
            <button disabled={loading} onClick={async()=>{await refreshAll();setRefreshKey(k=>k+1);}}>{loading ? <Loader2 size={13} className="spin" /> : <Activity size={13} />} Refresh</button>
            {view === "leads" && <button className="primary" onClick={() => setLeadModal(true)}><Plus size={13} /> New Lead</button>}
          </div>
        </header>

        <div className="crm-content">
          {error&&<div className="task-error" role="alert">{error}</div>}
          <AnimatePresence mode="wait">
            <motion.div key={view+refreshKey} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .24 }}>
              {view === "dashboard" && <Dashboard dashboard={dashboard} onNavigate={navigateCRM} />}
              {view === "leads" && (
                <LeadsView
                  leads={leads.filter(l=>(leadStatus==="archived"?l.metadata?.archived:!l.metadata?.archived&&(!leadStatus||l.status===leadStatus))&&[l.title,l.company,l.email,l.phone].some(v=>v?.toLowerCase().includes(search.toLowerCase())))}
                  search={search}
                  setSearch={(v) => { setSearch(v); }}
                  leadStatus={leadStatus}
                  setLeadStatus={(v) => { setLeadStatus(v); }}
                  updateLeadStatus={updateLeadStatus} onEdit={setEditingLead} busy={loading}
                />
              )}
              {view === "pipeline" && <Opportunities onChanged={refreshAll} />}
              {view === "agents" && <AgentsModule />}
              {view === "workflows" && <WorkflowsModule />}
              {view === "inbox" && <InboxModule />}
              {view === "notifications" && <NotificationsModule />}
              {view === "tasks" && <TasksView onChanged={refreshAll} />}
              {view === "integrations" && <IntegrationsView integrations={integrations} />}
              {view === "settings" && <WorkspaceSettings workspace={workspace} onChanged={refreshAll} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {editingLead&&<LeadEditor lead={editingLead} onClose={()=>setEditingLead(null)} onSaved={refreshAll}/>}
      <AnimatePresence>
        {leadModal && (
          <motion.div className="crm-modal-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.form className="crm-modal" onSubmit={createLead} initial={{ scale: .96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .96, y: 12 }}>
              <div role="alert" className="task-error">{error}</div><div className="crm-modal-head"><h3>Create New Lead</h3><button type="button" onClick={() => setLeadModal(false)}><X size={15} /></button></div>
              <div className="crm-form">
                <label className="full">Lead / Contact Name<input name="title" required placeholder="e.g. Acme Foods Pvt Ltd" /></label>
                <label>Company<input name="company" /></label>
                <label>Source<select name="source"><option>manual</option><option>website</option><option>referral</option><option>campaign</option><option>engagex</option></select></label>
                <label>Email<input name="email" type="email" /></label>
                <label>Phone<input name="phone" /></label>
                <label>Priority<select name="priority"><option>medium</option><option>high</option><option>urgent</option><option>low</option></select></label>
                <label>Estimated Value<input name="value" type="number" min="0" step="1" defaultValue="0" /></label>
                <div className="crm-form-actions"><button type="button" onClick={() => setLeadModal(false)}>Cancel</button><button className="primary" disabled={loading}>Create Lead</button></div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Dashboard({ dashboard, onNavigate }: { dashboard: any; onNavigate: (view: View, status?: string) => void }) {
  const metrics = [
    ["Total Leads", dashboard?.lead_total || 0, Users, "leads", ""],
    ["Qualified", dashboard?.lead_qualified || 0, CheckCircle2, "leads", "qualified"],
    ["Pipeline Value", formatMoney(dashboard?.pipeline_value || 0), CircleDollarSign, "pipeline", ""],
    ["Pending Tasks", dashboard?.tasks_pending || 0, ListTodo, "tasks", ""],
    ["Open Inbox", dashboard?.conversations_open || 0, Inbox, "inbox", ""],
    ["Active Agents", dashboard?.agents_active || 0, Bot, "agents", ""],
    ["Active Workflows", dashboard?.workflows_active || 0, Workflow, "workflows", ""],
    ["Won Value", formatMoney(dashboard?.won_value || 0), BriefcaseBusiness, "leads", "won"],
  ];

  const numericValues = [
    Number(dashboard?.lead_total || 0),
    Number(dashboard?.lead_new || 0),
    Number(dashboard?.lead_qualified || 0),
    Number(dashboard?.tasks_pending || 0),
    Number(dashboard?.conversations_open || 0),
    Number(dashboard?.agents_active || 0),
    Number(dashboard?.workflows_active || 0),
  ];
  const max = Math.max(1, ...numericValues);

  return <>
    <div className="crm-metrics">
      {metrics.map(([label, value, Icon, target, status]: any) => (
        <motion.button
          type="button"
          className="crm-card crm-metric crm-clickable-card"
          key={label}
          onClick={() => onNavigate(target as View, status || undefined)}
          whileHover={{ y: -5, scale: 1.012 }}
          whileTap={{ scale: .985 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
        >
          <div className="crm-metric-head"><span>{label}</span><div className="crm-metric-icon"><Icon size={14} /></div></div>
          <strong>{value}</strong><span>Click to open · Live workspace data</span>
        </motion.button>
      ))}
    </div>
    <div className="crm-dashboard-grid">
      <div className="crm-panel">
        <div className="crm-panel-head"><h3>Operational Pulse</h3><span>Real-time CRM counters</span></div>
        <div className="crm-chart">
          {numericValues.map((v, i) => <motion.div key={i} className="crm-chart-bar" initial={{ height: 18 }} animate={{ height: Math.max(18, 180 * (v / max)) }} transition={{ delay: i * .06, type: "spring" }} />)}
        </div>
      </div>
      <div className="crm-panel">
        <div className="crm-panel-head"><h3>Recent Activity</h3><span>{dashboard?.recent_activity?.length || 0} events</span></div>
        <div className="crm-activity-list">
          {(dashboard?.recent_activity || []).length ? dashboard.recent_activity.map((a: any) => (
            <div className="crm-activity" key={a.id}><i /><div><b>{a.title}</b><span>{a.description || a.activity_type}</span></div><time>{shortDate(a.created_at)}</time></div>
          )) : <EmptyMini text="No activity yet. CRM events will appear here automatically." />}
        </div>
      </div>
    </div>
  </>;
}

type LeadsViewProps = {
  leads: Lead[];
  search: string;
  setSearch: (value: string) => void;
  leadStatus: string;
  setLeadStatus: (value: string) => void;
  updateLeadStatus: (id: string, status: string) => Promise<void>;
  onEdit:(lead:Lead)=>void; busy:boolean;
};

function LeadsView({ leads, search, setSearch, leadStatus, setLeadStatus, updateLeadStatus, onEdit, busy }: LeadsViewProps) {
  return <>
    <div className="crm-toolbar">
      <div className="crm-search"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads by name, company, email or phone..." /></div>
      <div className="crm-filter-row">
        <button className={!leadStatus ? "active" : ""} onClick={() => setLeadStatus("")}>All</button>
        {[...statuses,"archived"].map((s) => <button key={s} className={leadStatus === s ? "active" : ""} onClick={() => setLeadStatus(s)}>{s}</button>)}
      </div>
    </div>
    {leads.length ? <div className="crm-panel"><table className="crm-table"><thead><tr><th>LEAD</th><th>SOURCE</th><th>PRIORITY</th><th>SCORE</th><th>VALUE</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>
      {leads.map((l: Lead) => <tr key={l.id} className="crm-clickable-row" onClick={()=>{window.location.href=`/crm/leads/${l.id}`;}}>
        <td><a href={`/crm/leads/${l.id}`} className="crm-lead-link"><strong>{l.title}</strong></a><small>{l.company || l.email || l.phone || "No secondary detail"}</small></td>
        <td><span className={`crm-badge ${l.source==="engagex"?"engagex":""}`}><i /> {l.source==="engagex"?"ENGAGEX":l.source}</span></td>
        <td>{l.priority}</td><td>{l.score}</td><td>{formatMoney(l.value || 0)}</td>
        <td onClick={e=>e.stopPropagation()}><select disabled={busy} className="crm-status-select" value={l.status} onChange={(e) => updateLeadStatus(l.id, e.target.value)}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></td>
        <td>{shortDate(l.created_at)}</td><td onClick={e=>e.stopPropagation()}><button onClick={()=>onEdit(l)}>Edit / Archive</button></td>
      </tr>)}
    </tbody></table></div> : <EmptyState icon={Users} title="No leads found" text="Create your first lead or change the current search/filter." />}
  </>;
}

function IntegrationsView({ integrations }: any) {
  const [syncing,setSyncing]=useState(false);
  const [syncMessage,setSyncMessage]=useState("");

  async function syncEngageX(){
    setSyncing(true); setSyncMessage("");
    const {data}=await crmSupabase.auth.getSession();
    const token=data.session?.access_token;
    if(!token){setSyncing(false);setSyncMessage("Authentication required.");return;}
    try{
    const res=await fetch("/api/integrations/engagex/sync",{method:"POST",headers:{Authorization:`Bearer ${token}`}});
    const body=await res.json().catch(()=>({}));
    setSyncing(false);
    if(res.ok) setSyncMessage(`EngageX sync complete: ${body.synced||0} synced, ${body.failed||0} failed.`);
    else setSyncMessage(body.message||body.error||"EngageX sync failed.");
    }catch{setSyncMessage("EngageX network request could not be confirmed. Refresh before retrying.");}finally{setSyncing(false);}
  }

  return <div>
    {syncMessage&&<div className="crm-panel crm-inline-message">{syncMessage}</div>}
    <div className="crm-integration-grid">{integrations.map((x: any) => <motion.div className="crm-card crm-integration-card" key={x.id} whileHover={{ y: -5 }}>
      <div className="crm-integration-top"><div className="crm-integration-icon"><Network size={18} /></div><span className={`crm-badge ${x.provider==="engagex"?"engagex":""}`}><i /> {x.status}</span></div>
      <h3>{x.display_name}</h3><p>{x.status === "connected" ? "Connected to the SAV AI workspace." : "Ready to configure when provider credentials are available."}</p>
      {x.provider==="engagex"&&<button onClick={syncEngageX} disabled={syncing}>{syncing?<Loader2 size={13}/>:<RefreshCw size={13}/>} Sync EngageX Leads</button>}
    </motion.div>)}</div>
  </div>;
}

function EmptyState({ icon: Icon, title, text }: any) {
  return <div className="crm-empty"><div><Icon size={26} /><h3>{title}</h3><p>{text}</p></div></div>;
}
function EmptyMini({ text }: { text: string }) { return <div className="crm-activity"><i /><div><b>Waiting for activity</b><span>{text}</span></div></div>; }
function formatMoney(v: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0)); }
function shortDate(v?: string | null) { if (!v) return "—"; return new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); }
