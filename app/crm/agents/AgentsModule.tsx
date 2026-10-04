"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, CheckCircle2, CircleAlert, Loader2, Pause, Play, Save, Search, ShieldAlert, TestTube2 } from "lucide-react";
import { crmSupabase } from "../supabase-client";
import { AgentRecord } from "./agent-types";
import { AgentApiError, executeAgent, getAgent, listAgents, reviewAgentAction, setAgentStatus, updateAgent } from "./agent-service";

const tabs=["Overview","Role & Instructions","Capabilities","Tasks","Channels","Knowledge","Workflows","Working Hours","Limits","Escalation","Activity","Audit"] as const;

export default function AgentsModule({focusedId}:{focusedId?:string}){
  const [agents,setAgents]=useState<AgentRecord[]>([]);
  const [metrics,setMetrics]=useState<Record<string,number>>({});
  const [selected,setSelected]=useState<string|undefined>(focusedId);
  const [detail,setDetail]=useState<any>(null);
  const [tab,setTab]=useState<(typeof tabs)[number]>("Overview");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [testInput,setTestInput]=useState("");
  const [leadId,setLeadId]=useState("");
  const [leads,setLeads]=useState<any[]>([]);
  const [testResult,setTestResult]=useState<any>(null);
  const [agentRunning,setAgentRunning]=useState(false);

  async function refresh(){
    setLoading(true);setError("");
    try{
      const data=await listAgents();
      setAgents(data.agents);setMetrics(data.metrics);
      const id=focusedId||selected||data.agents[0]?.id;
      if(id){setSelected(id);setDetail(await getAgent(id));}
      const {data:leadData}=await crmSupabase.rpc("sav_ai_crm_list_leads",{p_status:null,p_search:null});
      setLeads(leadData||[]);
    }catch(e){setError(e instanceof Error?e.message:"Could not load agents.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{refresh();},[focusedId]);

  async function openAgent(id:string){setSelected(id);setLoading(true);try{setDetail(await getAgent(id));setTab("Overview");}catch(e){setError(e instanceof Error?e.message:"Could not load agent.");}finally{setLoading(false);}}
  async function status(next:"active"|"paused"|"disabled"){
    if(!selected)return; setError("");setSuccess("");
    try{await setAgentStatus(selected,next);setSuccess("Agent status updated.");await refresh();}catch(e){setError(e instanceof Error?e.message:"Status update failed.");}
  }
  async function save(){
    if(!selected||!detail?.agent)return;
    try{
      await updateAgent(selected,{
        display_name:detail.agent.display_name,
        description:detail.agent.description||"",
        channels:detail.agent.channels||[],
        confidence_threshold:Number(detail.agent.confidence_threshold||0.7),
        working_hours:detail.agent.working_hours||{},
        daily_limits:detail.agent.daily_limits||{},
        escalation_rules:detail.agent.escalation_rules||{}
      });
      setSuccess("Agent settings saved.");await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Save failed.");}
  }
  async function runAnalyze(){
    if(!selected||!leadId||!testInput.trim())return;
    setTestResult(null);setError("");setAgentRunning(true);
    try{
      const result=await executeAgent(selected,testInput,{lead_id:leadId},{mode:"analyze"});
      setTestResult(result);
      const data=await listAgents();setMetrics(data.metrics);
      setDetail(await getAgent(selected));
    }catch(e){
      setTestResult({
        error:e instanceof AgentApiError?e.code:"AGENT_EXECUTION_FAILED",
        message:e instanceof Error?e.message:"Execution failed."
      });
    }finally{setAgentRunning(false);}
  }

  async function runExecute(){
    if(!selected||!leadId||!testResult?.result?.decision)return;
    setError("");setAgentRunning(true);
    try{
      const result=await executeAgent(
        selected,
        "Execute validated SAV-Sales CRM actions from analyzed decision",
        {lead_id:leadId},
        {
          mode:"execute",
          decision:testResult.result.decision,
          sourceExecutionId:testResult.execution_id
        }
      );
      setTestResult(result);
      const data=await listAgents();setMetrics(data.metrics);
      setDetail(await getAgent(selected));
    }catch(e){
      setTestResult({
        error:e instanceof AgentApiError?e.code:"AGENT_EXECUTION_FAILED",
        message:e instanceof Error?e.message:"Execution failed."
      });
    }finally{setAgentRunning(false);}
  }
  async function review(actionId:string,decision:"approve"|"reject"){
    setError("");setSuccess("");
    try{
      await reviewAgentAction(actionId,decision,decision==="approve"?"Approved from agent detail":"Rejected from agent detail");
      setSuccess(decision==="approve"?"Action approved.":"Action rejected.");
      if(selected)setDetail(await getAgent(selected));
      const data=await listAgents();setMetrics(data.metrics);
    }catch(e){setError(e instanceof Error?e.message:"Approval review failed.");}
  }


  const current=useMemo(()=>agents.find(a=>a.id===selected),[agents,selected]);
  if(loading && !agents.length)return <div className="agent-loading"><Loader2 className="spin" size={20}/> Loading AI agents...</div>;

  return <div className="agent-module">
    <div className="agent-metrics">
      <Metric label="Active agents" value={metrics.active_agents||0}/>
      <Metric label="Executions" value={metrics.executions||0}/>
      <Metric label="Successful" value={metrics.successful_executions||0}/>
      <Metric label="Failed" value={metrics.failed_executions||0}/>
      <Metric label="Pending approvals" value={metrics.pending_approvals||0}/>
      <Metric label="Escalations" value={metrics.escalations||0}/>
      <Metric label="Tasks created" value={metrics.tasks_created||0}/>
      <Metric label="Follow-ups" value={metrics.followups_created||0}/>
    </div>

    {error&&<div className="task-error">{error}</div>}
    {success&&<div className="agent-success">{success}</div>}

    <div className="agent-layout">
      <aside className="agent-list">
        <div className="agent-list-head"><Bot size={15}/><b>AI Agent Registry</b></div>
        {agents.map(a=><button key={a.id} className={a.id===selected?"active":""} onClick={()=>openAgent(a.id)}>
          <span className="agent-avatar"><Bot size={15}/></span>
          <span><b>{a.display_name||a.name}</b><small>{a.role_name}</small></span>
          <em className={"agent-status "+a.status}>{a.status}</em>
        </button>)}
      </aside>

      <section className="agent-detail">
        {!current||!detail?<div className="crm-empty"><div><Bot size={26}/><h3>Select an agent</h3></div></div>:<>
          <div className="agent-detail-head">
            <div><small>{current.slug}</small><h2>{detail.agent.display_name||current.name}</h2><p>{detail.agent.role_name}</p></div>
            <div className="agent-head-actions">
              {detail.permissions?.manage&&<>
                <button onClick={()=>status("active")} disabled={current.status==="active"}><Play size={13}/>Active</button>
                <button onClick={()=>status("paused")} disabled={current.status==="paused"}><Pause size={13}/>Pause</button>
                <button onClick={()=>status("disabled")} disabled={current.status==="disabled"}><ShieldAlert size={13}/>Disable</button>
                <button className="primary" onClick={save}><Save size={13}/>Save</button>
              </>}
              <Link href={`/crm/agents/${current.id}`}>Open Detail</Link>
            </div>
          </div>

          <div className="agent-tabs">{tabs.map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</div>
          <div className="agent-tab-body">
            {tab==="Overview"&&<><Overview detail={detail}/><ApprovalQueue rows={detail.approvals||[]} onReview={review}/></>}
            {tab==="Role & Instructions"&&<EditBasics detail={detail} setDetail={setDetail}/>}
            {tab==="Capabilities"&&<CapabilityView rows={detail.capabilities||[]}/>}
            {tab==="Tasks"&&<RecordList rows={detail.tasks||[]} empty="No AI-assigned tasks yet."/>}
            {tab==="Channels"&&<ChannelEditor detail={detail} setDetail={setDetail}/>}
            {tab==="Knowledge"&&<RecordList rows={detail.knowledge||[]} empty="No knowledge scopes assigned."/>}
            {tab==="Workflows"&&<RecordList rows={detail.workflows||[]} empty="No workflow access configured."/>}
            {tab==="Working Hours"&&<JsonEditor label="Working hours" value={detail.agent.working_hours||{}} onChange={v=>setDetail({...detail,agent:{...detail.agent,working_hours:v}})}/>}
            {tab==="Limits"&&<JsonEditor label="Daily limits" value={detail.agent.daily_limits||{}} onChange={v=>setDetail({...detail,agent:{...detail.agent,daily_limits:v}})}/>}
            {tab==="Escalation"&&<><JsonEditor label="Escalation rules" value={detail.agent.escalation_rules||{}} onChange={v=>setDetail({...detail,agent:{...detail.agent,escalation_rules:v}})}/><RecordList rows={detail.escalations||[]} empty="No escalations yet."/></>}
            {tab==="Activity"&&<RecordList rows={[...(detail.executions||[]),...(detail.actions||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))} empty="No agent activity yet."/>}
            {tab==="Audit"&&<RecordList rows={detail.audit||[]} empty="No audit events yet."/>}
          </div>

          <div className="agent-test-console">
            <div className="agent-console-head"><TestTube2 size={15}/><div><b>Agent Test Console</b><span>{current.status==="active"?"Active agent — ready to work":"Agent is "+current.status+" — enable it to run work"}</span></div></div>
            <label>Context / Lead<select value={leadId} onChange={e=>setLeadId(e.target.value)}><option value="">No lead context</option>{leads.map(l=><option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
            <label>Test input<textarea value={testInput} onChange={e=>setTestInput(e.target.value)} placeholder="Describe what the agent should analyze or plan..."/></label>
            <div className="agent-head-actions">
              <button className="task-new-btn" onClick={runAnalyze} disabled={current.status!=="active"||agentRunning||!leadId||!testInput.trim()}>
                {agentRunning?<Loader2 size={13} className="spin"/>:<Activity size={13}/>}Analyze & Plan
              </button>
              {current.slug==="sav-sales"&&testResult?.mode==="analyze"&&testResult?.result?.decision&&
                <button onClick={runExecute} disabled={current.status!=="active"||agentRunning}>
                  <Play size={13}/>Execute Approved Actions
                </button>}
            </div>
            {testResult&&<pre className="agent-console-result">{JSON.stringify(testResult,null,2)}</pre>}
          </div>
        </>}
      </section>
    </div>
  </div>;
}

function ApprovalQueue({rows,onReview}:{rows:any[];onReview:(id:string,decision:"approve"|"reject")=>void}){
  const pending=rows.filter(x=>x.status==="pending");
  if(!pending.length)return null;
  return <div className="agent-approval-queue"><div className="agent-console-head"><ShieldAlert size={15}/><div><b>Approval Required</b><span>{pending.length} pending high/critical action(s)</span></div></div>
    {pending.map(x=><div className="agent-approval-row" key={x.id}><div><b>{x.action}</b><span>{x.risk_level} risk · {x.target_type}</span></div><div><button onClick={()=>onReview(x.action_id,"reject")}>Reject</button><button className="primary" onClick={()=>onReview(x.action_id,"approve")}>Approve</button></div></div>)}
  </div>;
}
function Metric({label,value}:{label:string;value:number}){return <div className="crm-card agent-metric"><span>{label}</span><strong>{value}</strong></div>}
function Overview({detail}:{detail:any}){return <div className="agent-overview-grid">
  <Info label="Status" value={detail.agent.status}/><Info label="Autonomy" value={detail.agent.autonomy_level}/><Info label="Confidence" value={String(detail.agent.confidence_threshold)}/><Info label="Approval default" value={detail.agent.approval_required?"Required":"Not required"}/>
  <div className="agent-wide"><b>Description</b><p>{detail.agent.description||"No description."}</p></div>
</div>}
function Info({label,value}:{label:string;value:string}){return <div className="crm-card"><span>{label}</span><strong>{value}</strong></div>}
function EditBasics({detail,setDetail}:{detail:any;setDetail:(v:any)=>void}){return <div className="crm-form">
  <label>Display name<input value={detail.agent.display_name||""} onChange={e=>setDetail({...detail,agent:{...detail.agent,display_name:e.target.value}})}/></label>
  <label>Confidence threshold<input type="number" min="0" max="1" step="0.01" value={detail.agent.confidence_threshold||0.7} onChange={e=>setDetail({...detail,agent:{...detail.agent,confidence_threshold:Number(e.target.value)}})}/></label>
  <label className="full">Role<input value={detail.agent.role_name||""} disabled/></label>
  <label className="full">Instructions / description<textarea value={detail.agent.description||""} onChange={e=>setDetail({...detail,agent:{...detail.agent,description:e.target.value}})}/></label>
</div>}
function CapabilityView({rows}:{rows:any[]}){return <div className="agent-cap-grid">{rows.map(x=><div className="crm-card" key={x.id}><b>{x.capability}</b><span>{x.risk_level} risk</span><em>{x.approval_required?"Approval required":"Direct internal action"}</em></div>)}</div>}
function ChannelEditor({detail,setDetail}:{detail:any;setDetail:(v:any)=>void}){const all=["crm","voice","whatsapp","sms","email","webchat"];return <div className="agent-channel-grid">{all.map(c=><label key={c}><input type="checkbox" checked={(detail.agent.channels||[]).includes(c)} onChange={e=>{const set=new Set(detail.agent.channels||[]);e.target.checked?set.add(c):set.delete(c);setDetail({...detail,agent:{...detail.agent,channels:[...set]}})}}/>{c}</label>)}</div>}
function JsonEditor({label,value,onChange}:{label:string;value:Record<string,unknown>;onChange:(v:Record<string,unknown>)=>void}){const [text,setText]=useState(JSON.stringify(value,null,2));return <label className="agent-json">{label}<textarea value={text} onChange={e=>{setText(e.target.value);try{onChange(JSON.parse(e.target.value))}catch{}}}/></label>}
function RecordList({rows,empty}:{rows:any[];empty:string}){if(!rows.length)return <div className="crm-empty"><div><CheckCircle2 size={22}/><p>{empty}</p></div></div>;return <div className="crm-activity-list">{rows.map((x,i)=><div className="crm-activity" key={x.id||i}><i/><div><b>{x.title||x.action||x.command||x.knowledge_scope||x.workflow_key||x.status||"Record"}</b><span>{x.description||x.error||x.execution_status||x.risk_level||x.access_level||""}</span></div><time>{x.created_at?new Date(x.created_at).toLocaleDateString("en-IN"):""}</time></div>)}</div>}
