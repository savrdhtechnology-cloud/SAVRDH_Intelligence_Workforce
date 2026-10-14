"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { Activity,Loader2,Mail,Settings2,Workflow } from "lucide-react";
import { crmSupabase, crmSupabaseConfigured } from "../supabase-client";
import WorkflowsModule from "./WorkflowsModule";
import WorkflowActivity from "./WorkflowActivity";
import "../crm.css";

type Tab="runs"|"messages"|"builder";
const TABS:{id:Tab;label:string;hint:string;icon:typeof Activity}[]=[
 {id:"runs",label:"What happened",hint:"Every run, step by step",icon:Activity},
 {id:"messages",label:"Customer messages",hint:"Who got which email or message",icon:Mail},
 {id:"builder",label:"Workflow builder",hint:"Edit workflows (advanced)",icon:Settings2},
];

export default function WorkflowsRouteShell({workflowId}:{workflowId?:string}){
 const [ready,setReady]=useState(false),[authed,setAuthed]=useState(false);
 const [tab,setTab]=useState<Tab>(workflowId?"builder":"runs");
 useEffect(()=>{if(!crmSupabaseConfigured)return;crmSupabase.auth.getSession().then(({data})=>{setAuthed(Boolean(data.session));setReady(true);});},[]);
 useEffect(()=>{try{const t=new URLSearchParams(window.location.search).get("tab");if(t==="runs"||t==="messages"||t==="builder")setTab(t);}catch{/* ignore */}},[]);
 function choose(t:Tab){setTab(t);try{const u=new URL(window.location.href);u.searchParams.set("tab",t);window.history.replaceState(null,"",u.toString());}catch{/* ignore */}}
 if(!crmSupabaseConfigured)return <div className="crm-auth-page"><div className="crm-auth-card" role="alert"><h2>Savrdh AI OS configuration required</h2><p>Supabase environment is not configured for this deployment.</p></div></div>;
 if(!ready)return <div className="crm-auth-page"><Loader2 className="spin" size={20}/></div>;
 if(!authed)return <div className="crm-auth-page"><div className="crm-auth-card"><Workflow size={24}/><h2>Savrdh AI OS sign-in required</h2><p>Sign in before managing workflows.</p><Link href="/crm">Open AI OS Login</Link></div></div>;
 return <div className="workflow-route-page">
  <header className="agent-route-head"><div><small>SAVRDH AI OS</small><h1>Workflows</h1></div><Link href="/admin">Back to Admin</Link></header>
  <nav className="wa-tabs" role="tablist" aria-label="Workflow views">{TABS.map(t=><button key={t.id} role="tab" aria-selected={tab===t.id} onClick={()=>choose(t.id)}><t.icon size={16}/><span>{t.label}<small>{t.hint}</small></span></button>)}</nav>
  {tab==="runs"&&<WorkflowActivity view="runs"/>}
  {tab==="messages"&&<WorkflowActivity view="messages"/>}
  {tab==="builder"&&<WorkflowsModule focusedId={workflowId}/>}
 </div>;
}
