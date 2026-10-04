"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Archive, Bot, CheckCircle2, CircleAlert, Copy, GitBranch, Loader2,
  Pause, Play, Plus, Save, TestTube2, Trash2, Workflow, X, Zap
} from "lucide-react";
import { crmSupabase } from "../supabase-client";
import {
  WORKFLOW_NODE_TYPES, WORKFLOW_TRIGGERS, WorkflowGraph, WorkflowNode, WorkflowNodeType,
  WorkflowRecord, validateGraph
} from "./workflow-types";
import {
  createWorkflow, deleteWorkflow, duplicateWorkflow, executeWorkflow, getWorkflow, listWorkflows,
  testWorkflow, updateWorkflow, workflowStatus
} from "./workflow-service";

const blankGraph:WorkflowGraph={
  nodes:[
    {id:"trigger",type:"TRIGGER",label:"Manual Trigger",position:{x:80,y:140},config:{conditions:[]}},
    {id:"end",type:"END",label:"End",position:{x:520,y:140},config:{}}
  ],
  edges:[{id:"edge-trigger-end",source:"trigger",target:"end"}]
};

export default function WorkflowsModule({focusedId}:{focusedId?:string}){
  const [workflows,setWorkflows]=useState<WorkflowRecord[]>([]);
  const [templates,setTemplates]=useState<any[]>([]);
  const [metrics,setMetrics]=useState<Record<string,any>>({});
  const [selected,setSelected]=useState<string|undefined>(focusedId);
  const [detail,setDetail]=useState<any>(null);
  const [graph,setGraph]=useState<WorkflowGraph>(blankGraph);
  const [selectedNode,setSelectedNode]=useState<string|null>(null);
  const [connectFrom,setConnectFrom]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [createOpen,setCreateOpen]=useState(false);
  const [testContext,setTestContext]=useState('{"lead":{"id":"","source":"website","status":"new","priority":"high","value":500000}}');
  const [testResult,setTestResult]=useState<any>(null);
  const [agents,setAgents]=useState<any[]>([]);

  async function refresh(preferred?:string){
    setLoading(true);setError("");
    try{
      const [{workflows:rows,metrics:m,templates:t},agentRes]=await Promise.all([
        listWorkflows(),crmSupabase.rpc("sav_ai_crm_agent_registry")
      ]);
      setWorkflows(rows);setMetrics(m);setTemplates(t);setAgents(agentRes.data||[]);
      const id=focusedId||preferred||selected||rows[0]?.id;
      if(id){setSelected(id);const d=await getWorkflow(id);setDetail(d);setGraph({nodes:d.nodes||[],edges:d.edges||[]});}
      else{setSelected(undefined);setDetail(null);}
    }catch(e){setError(e instanceof Error?e.message:"Could not load workflows.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{refresh();},[focusedId]);

  async function openWorkflow(id:string){
    setSelected(id);setLoading(true);setError("");
    try{const d=await getWorkflow(id);setDetail(d);setGraph({nodes:d.nodes||[],edges:d.edges||[]});setSelectedNode(null);}
    catch(e){setError(e instanceof Error?e.message:"Could not load workflow.");}
    finally{setLoading(false);}
  }
  async function save(){
    if(!selected||!detail?.workflow)return;
    const errors=validateGraph(graph);if(errors.length){setError(errors.join(" "));return;}
    setSaving(true);setError("");setSuccess("");
    try{
      const r=await updateWorkflow(selected,{name:detail.workflow.name,description:detail.workflow.description||"",trigger_type:detail.workflow.trigger_type,graph});
      setSuccess(`Saved as workflow version ${r.version}.`);await refresh(selected);
    }catch(e){setError(e instanceof Error?e.message:"Workflow save failed.");}
    finally{setSaving(false);}
  }
  async function setStatus(status:"active"|"paused"|"disabled"){
    if(!selected)return;
    const operation=status==="active"?"enable":status==="paused"?"pause":"disable";
    try{await workflowStatus(selected,operation);setSuccess(`Workflow ${status}.`);await refresh(selected);}catch(e){setError(e instanceof Error?e.message:"Status change failed.");}
  }
  async function duplicate(){
    if(!selected)return;try{const r=await duplicateWorkflow(selected);setSuccess("Workflow duplicated.");await refresh(r.id);}catch(e){setError(e instanceof Error?e.message:"Duplicate failed.");}
  }
  async function archive(){
    if(!selected||!window.confirm("Archive this workflow?"))return;try{await deleteWorkflow(selected);setSuccess("Workflow archived.");setSelected(undefined);setDetail(null);await refresh();}catch(e){setError(e instanceof Error?e.message:"Archive failed.");}
  }
  async function runTest(){
    if(!selected)return;setTestResult(null);setError("");
    try{const ctx=JSON.parse(testContext);setTestResult(await testWorkflow(selected,ctx));}
    catch(e){setTestResult({error:e instanceof Error?e.message:"Test failed."});}
  }
  async function execute(){
    if(!selected)return;
    if(!window.confirm("Execute this workflow with the current sample context? External notification nodes remain fail-closed."))return;
    try{const ctx=JSON.parse(testContext);setTestResult(await executeWorkflow(selected,ctx,`manual:${selected}:${Date.now()}`));await refresh(selected);}
    catch(e){setTestResult({error:e instanceof Error?e.message:"Execution failed."});}
  }

  function addNode(type:WorkflowNodeType){
    const id=`${type.toLowerCase()}-${Date.now()}`;
    const node:WorkflowNode={id,type,label:type.replaceAll("_"," "),position:{x:220+Math.round(Math.random()*260),y:90+Math.round(Math.random()*260)},config:defaultConfig(type,agents)};
    setGraph(g=>({...g,nodes:[...g.nodes,node]}));setSelectedNode(id);
  }
  function removeNode(id:string){
    if(graph.nodes.find(n=>n.id===id)?.type==="TRIGGER"){setError("The TRIGGER node cannot be deleted.");return;}
    if(graph.nodes.find(n=>n.id===id)?.type==="END"){setError("The END node cannot be deleted.");return;}
    setGraph(g=>({nodes:g.nodes.filter(n=>n.id!==id),edges:g.edges.filter(e=>e.source!==id&&e.target!==id)}));setSelectedNode(null);
  }
  function nodeClick(id:string){
    if(connectFrom&&connectFrom!==id){
      const edgeId=`edge-${connectFrom}-${id}-${Date.now()}`;
      setGraph(g=>({...g,edges:[...g.edges,{id:edgeId,source:connectFrom,target:id}]}));setConnectFrom(null);
    }else setSelectedNode(id);
  }
  function updateNode(node:WorkflowNode){setGraph(g=>({...g,nodes:g.nodes.map(n=>n.id===node.id?node:n)}));}

  const selectedNodeRecord=useMemo(()=>graph.nodes.find(n=>n.id===selectedNode)||null,[graph,selectedNode]);

  if(loading&&!workflows.length)return <div className="workflow-loading"><Loader2 size={20} className="spin"/> Loading workflow engine...</div>;

  return <motion.div
    className="workflow-module"
    initial={{opacity:0,y:8}}
    animate={{opacity:1,y:0}}
    transition={{duration:.35,ease:[.22,1,.36,1]}}
  >
    <motion.div
      className="workflow-metrics"
      initial="hidden"
      animate="show"
      variants={{hidden:{opacity:0},show:{opacity:1,transition:{staggerChildren:.055}}}}
    >
      <Metric label="Active workflows" value={metrics.active_workflows||0}/>
      <Metric label="Executions today" value={metrics.executions_today||0}/>
      <Metric label="Successful" value={metrics.successful||0}/>
      <Metric label="Failed" value={metrics.failed||0}/>
      <Metric label="Waiting" value={metrics.waiting||0}/>
      <Metric label="Approval pending" value={metrics.approval_pending||0}/>
      <Metric label="Avg seconds" value={Math.round(Number(metrics.average_execution_seconds||0))}/>
    </motion.div>

    <AnimatePresence mode="popLayout">
      {error&&<motion.div className="task-error" initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}}>{error}</motion.div>}
    </AnimatePresence>
    <AnimatePresence mode="popLayout">
      {success&&<motion.div className="agent-success" initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}}>{success}</motion.div>}
    </AnimatePresence>

    <div className="workflow-toolbar">
      <div><b>Workflow Registry</b><span>Database-backed orchestration</span></div>
      <div>
        <Link href="/crm/workflows/executions">Executions</Link>
        <button className="task-new-btn" onClick={()=>setCreateOpen(true)}><Plus size={13}/>New Workflow</button>
      </div>
    </div>

    <div className="workflow-layout">
      <motion.aside
        className="workflow-list"
        initial="hidden"
        animate="show"
        variants={{hidden:{opacity:0,x:-8},show:{opacity:1,x:0,transition:{staggerChildren:.05}}}}
      >
        {workflows.length?workflows.map(w=><motion.button
          key={w.id}
          className={w.id===selected?"active":""}
          onClick={()=>openWorkflow(w.id)}
          variants={{hidden:{opacity:0,x:-8},show:{opacity:1,x:0}}}
          whileHover={{x:3}}
          whileTap={{scale:.985}}
          transition={{duration:.18}}
        >
          <span><b>{w.name}</b><small>{w.trigger_type} · v{w.version}</small></span><em className={"workflow-status "+w.status}>{w.status}</em>
        </motion.button>):<div className="crm-empty"><div><Workflow size={24}/><h3>No workflows</h3><p>Create one or start from a template.</p></div></div>}
      </motion.aside>

      <AnimatePresence mode="wait">
      <motion.section
        key={selected || "empty"}
        className="workflow-detail"
        initial={{opacity:0,y:8,scale:.995}}
        animate={{opacity:1,y:0,scale:1}}
        exit={{opacity:0,y:-5,scale:.997}}
        transition={{duration:.24,ease:[.22,1,.36,1]}}
      >
        {!detail?<div className="crm-empty"><div><Workflow size={26}/><h3>Select a workflow</h3></div></div>:<>
          <div className="workflow-detail-head">
            <div className="workflow-title-edit">
              <input value={detail.workflow.name||""} onChange={e=>setDetail({...detail,workflow:{...detail.workflow,name:e.target.value}})}/>
              <textarea value={detail.workflow.description||""} onChange={e=>setDetail({...detail,workflow:{...detail.workflow,description:e.target.value}})} placeholder="Workflow description"/>
              <select value={detail.workflow.trigger_type} onChange={e=>setDetail({...detail,workflow:{...detail.workflow,trigger_type:e.target.value}})}>{WORKFLOW_TRIGGERS.map(t=><option key={t}>{t}</option>)}</select>
            </div>
            <div className="workflow-actions">
              <button onClick={()=>setStatus("active")}><Play size={12}/>Enable</button>
              <button onClick={()=>setStatus("paused")}><Pause size={12}/>Pause</button>
              <button onClick={()=>setStatus("disabled")}><CircleAlert size={12}/>Disable</button>
              <button onClick={duplicate}><Copy size={12}/>Duplicate</button>
              <button className="primary" onClick={save} disabled={saving}><Save size={12}/>{saving?"Saving":"Save v"+detail.workflow.version}</button>
              <button className="danger" onClick={archive}><Archive size={12}/>Archive</button>
            </div>
          </div>

          <div className="workflow-builder-wrap">
            <div className="workflow-palette">
              <b>Nodes</b>
              {WORKFLOW_NODE_TYPES.filter(t=>!["TRIGGER","END"].includes(t)).map(t=><button key={t} onClick={()=>addNode(t)}><Plus size={10}/>{t.replaceAll("_"," ")}</button>)}
            </div>
            <WorkflowCanvas graph={graph} selectedNode={selectedNode} connectFrom={connectFrom} onNodeClick={nodeClick} onMove={(id,pos)=>setGraph(g=>({...g,nodes:g.nodes.map(n=>n.id===id?{...n,position:pos}:n)}))}/>
            <div className="workflow-inspector">
              {selectedNodeRecord?<NodeInspector node={selectedNodeRecord} agents={agents} onChange={updateNode} onConnect={()=>setConnectFrom(selectedNodeRecord.id)} onDelete={()=>removeNode(selectedNodeRecord.id)}/>:<>
                <b>Inspector</b><p>Select a node to edit its persisted configuration.</p>
                <div className="workflow-version-list"><b>Versions</b>{(detail.versions||[]).map((v:any)=><span key={v.version}>v{v.version} · {new Date(v.created_at).toLocaleDateString("en-IN")}</span>)}</div>
              </>}
              <EdgeEditor graph={graph} setGraph={setGraph}/>
            </div>
          </div>

          <div className="workflow-test-panel">
            <div className="agent-console-head"><TestTube2 size={15}/><div><b>TEST WORKFLOW</b><span>Plan first. Execution requires explicit confirmation.</span></div></div>
            <textarea value={testContext} onChange={e=>setTestContext(e.target.value)}/>
            <div><button onClick={runTest}><TestTube2 size={12}/>Plan Test</button><button className="primary" onClick={execute}><Zap size={12}/>Execute Confirmed</button></div>
            {testResult&&<pre>{JSON.stringify(testResult,null,2)}</pre>}
          </div>

          <div className="workflow-history">
            <div className="crm-panel-head"><h3>Recent executions</h3><Link href="/crm/workflows/executions">View all</Link></div>
            {(detail.executions||[]).length?<div className="crm-activity-list">{detail.executions.map((e:any)=><Link className="crm-activity" href={`/crm/workflows/executions/${e.id}`} key={e.id}><i/><div><b>{e.trigger}</b><span>{e.execution_state} · node {e.current_node_id||"complete"}</span></div><time>{new Date(e.updated_at).toLocaleString("en-IN")}</time></Link>)}</div>:<p className="workflow-empty-copy">No executions yet.</p>}
          </div>
        </>}
      </motion.section>
      </AnimatePresence>
    </div>

    {createOpen&&<CreateWorkflowModal templates={templates} onClose={()=>setCreateOpen(false)} onCreated={async id=>{setCreateOpen(false);await refresh(id);}}/>}
  </motion.div>;
}

function Metric({label,value}:{label:string;value:number}){return <motion.div
  className="crm-card workflow-metric"
  variants={{hidden:{opacity:0,y:10},show:{opacity:1,y:0}}}
  whileHover={{y:-3,scale:1.01}}
  transition={{duration:.22,ease:[.22,1,.36,1]}}
><span>{label}</span><strong>{value}</strong></motion.div>}

function WorkflowCanvas({graph,selectedNode,connectFrom,onNodeClick,onMove}:{graph:WorkflowGraph;selectedNode:string|null;connectFrom:string|null;onNodeClick:(id:string)=>void;onMove:(id:string,pos:{x:number;y:number})=>void}){
  const canvas=useRef<HTMLDivElement>(null);
  function down(e:ReactPointerEvent<HTMLButtonElement>,node:WorkflowNode){
    if((e.target as HTMLElement).closest(".workflow-node-body-button"))return;
    const startX=e.clientX,startY=e.clientY,start=node.position;
    const move=(ev:PointerEvent)=>onMove(node.id,{x:Math.max(10,start.x+ev.clientX-startX),y:Math.max(10,start.y+ev.clientY-startY)});
    const up=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up)};
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);
  }
  const byId=new Map(graph.nodes.map(n=>[n.id,n]));
  return <motion.div
    className="workflow-canvas"
    ref={canvas}
    initial={{opacity:0,scale:.99}}
    animate={{opacity:1,scale:1}}
    transition={{duration:.32,ease:[.22,1,.36,1]}}
  >
    <svg className="workflow-edge-layer">{graph.edges.map(e=>{const s=byId.get(e.source),t=byId.get(e.target);if(!s||!t)return null;const x1=s.position.x+160,y1=s.position.y+30,x2=t.position.x,y2=t.position.y+30;return <g key={e.id}><path d={`M ${x1} ${y1} C ${x1+70} ${y1}, ${x2-70} ${y2}, ${x2} ${y2}`}/>{e.branch&&<text x={(x1+x2)/2} y={(y1+y2)/2-6}>{e.branch}</text>}</g>})}</svg>
    {graph.nodes.map((n,index)=><motion.button
      key={n.id}
      onPointerDown={e=>down(e,n)}
      onClick={()=>onNodeClick(n.id)}
      className={`workflow-node node-${n.type.toLowerCase()} ${selectedNode===n.id?"selected":""} ${connectFrom===n.id?"connecting":""}`}
      style={{left:n.position.x,top:n.position.y}}
      initial={{opacity:0,scale:.92,y:8}}
      animate={{opacity:1,scale:1,y:0}}
      transition={{duration:.24,delay:Math.min(index*.035,.25),ease:[.22,1,.36,1]}}
      whileHover={{scale:1.025,y:-2}}
      whileTap={{scale:.985}}
    >
      <span>{n.type}</span><b>{n.label}</b><small>{nodeSummary(n)}</small>
    </motion.button>)}
  </motion.div>;
}

function NodeInspector({node,agents,onChange,onConnect,onDelete}:{node:WorkflowNode;agents:any[];onChange:(n:WorkflowNode)=>void;onConnect:()=>void;onDelete:()=>void}){
  const [json,setJson]=useState(JSON.stringify(node.config,null,2));
  useEffect(()=>setJson(JSON.stringify(node.config,null,2)),[node.id]);
  return <div className="workflow-node-inspector">
    <b>{node.type}</b>
    <label>Label<input value={node.label} onChange={e=>onChange({...node,label:e.target.value})}/></label>
    {node.type==="AI_AGENT"&&<label>Agent<select value={String(node.config.agent_id||"")} onChange={e=>onChange({...node,config:{...node.config,agent_id:e.target.value}})}><option value="">Select agent</option>{agents.map(a=><option key={a.id} value={a.id}>{a.display_name||a.name}</option>)}</select></label>}
    <label>Configuration JSON<textarea value={json} onChange={e=>{setJson(e.target.value);try{onChange({...node,config:JSON.parse(e.target.value)})}catch{}}}/></label>
    <div className="workflow-inspector-actions"><button onClick={onConnect}><GitBranch size={11}/>Connect from node</button>{!["TRIGGER","END"].includes(node.type)&&<button className="danger" onClick={onDelete}><Trash2 size={11}/>Delete node</button>}</div>
  </div>;
}

function EdgeEditor({graph,setGraph}:{graph:WorkflowGraph;setGraph:(updater:(g:WorkflowGraph)=>WorkflowGraph)=>void}){
  if(!graph.edges.length)return null;
  return <div className="workflow-edge-editor"><b>Connections</b>{graph.edges.map(edge=><div key={edge.id}>
    <span>{edge.source} → {edge.target}</span>
    <select value={edge.branch||""} onChange={e=>setGraph(g=>({...g,edges:g.edges.map(x=>x.id===edge.id?{...x,branch:e.target.value||null}:x)}))}>
      <option value="">default</option><option value="true">true</option><option value="false">false</option><option value="approved">approved</option><option value="rejected">rejected</option>
    </select>
    <button onClick={()=>setGraph(g=>({...g,edges:g.edges.filter(x=>x.id!==edge.id)}))}><X size={10}/></button>
  </div>)}</div>;
}

function CreateWorkflowModal({templates,onClose,onCreated}:{templates:any[];onClose:()=>void;onCreated:(id:string)=>void}){
  const [saving,setSaving]=useState(false);const [error,setError]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const templateId=String(fd.get("template")||"");const template=templates.find(t=>t.id===templateId);setSaving(true);setError("");try{const r=await createWorkflow({name:String(fd.get("name")||""),description:String(fd.get("description")||""),trigger_type:String(fd.get("trigger")||template?.trigger_type||"MANUAL_TRIGGER"),graph:template?.definition||blankGraph,template_id:templateId||null});onCreated(r.id);}catch(e){setError(e instanceof Error?e.message:"Create failed.");}finally{setSaving(false);}}
  return <div className="crm-modal-wrap"><form className="crm-modal" onSubmit={submit}><div className="crm-modal-head"><h3>Create Workflow</h3><button type="button" onClick={onClose}><X size={14}/></button></div><div className="crm-form">
    <label className="full">Name<input name="name" required minLength={3}/></label><label className="full">Description<textarea name="description"/></label>
    <label>Template<select name="template"><option value="">Blank workflow</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <label>Trigger<select name="trigger" defaultValue="MANUAL_TRIGGER">{WORKFLOW_TRIGGERS.map(t=><option key={t}>{t}</option>)}</select></label>
    {error&&<div className="task-error full">{error}</div>}<div className="crm-form-actions"><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving?"Creating...":"Create"}</button></div>
  </div></form></div>;
}

function defaultConfig(type:WorkflowNodeType,agents:any[]):Record<string,unknown>{
  if(type==="CONDITION")return {condition:{field:"lead.status",operator:"equals",value:"qualified"}};
  if(type==="AI_AGENT")return {agent_id:agents[0]?.id||"",action:"CREATE_TASK",target_type:"lead",target_id_path:"lead.id",payload:{title:"AI agent task"}};
  if(type==="TASK")return {lead_id_path:"lead.id",title:"Workflow task",priority:"medium"};
  if(type==="FOLLOW_UP")return {lead_id_path:"lead.id",title:"Workflow follow-up",priority:"medium",followup_type:"general"};
  if(type==="WAIT")return {delay_seconds:3600};
  if(type==="HUMAN_APPROVAL")return {approver_role:"manager",reason:"Workflow approval required",risk_level:"high",timeout_seconds:86400};
  if(type==="ESCALATION")return {agent_id:agents[0]?.id||"",lead_id_path:"lead.id",reason:"FAILED_ACTION",details:"Workflow escalation"};
  if(type==="NOTIFICATION")return {channel:"in_app",notification_type:"WORKFLOW_STARTED",title:"Workflow notification",body:"Workflow notification",priority:"medium",recipient_member_id_path:"member.id",deep_link:"/crm/workflows"};
  if(type==="ACTION")return {action:"ADD_NOTE",lead_id_path:"lead.id",note:"Workflow note"};
  return {};
}
function nodeSummary(n:WorkflowNode){
  if(n.type==="WAIT")return `${n.config.delay_seconds||0}s`;
  if(n.type==="CONDITION"){
    const condition=n.config.condition;
    if(condition&&typeof condition==="object"&&!Array.isArray(condition)&&"field" in condition)return String((condition as Record<string,unknown>).field||"condition");
    return "condition";
  }
  if(n.type==="AI_AGENT")return String(n.config.action||"agent action");
  return String(n.config.action||n.config.title||"");
}
