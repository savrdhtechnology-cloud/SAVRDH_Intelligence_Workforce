import { crmSupabase } from "../supabase-client";
import { AgentCapability, AgentRecord } from "./agent-types";

async function authHeaders(){
  const {data}=await crmSupabase.auth.getSession();
  const token=data.session?.access_token;
  if(!token) throw new Error("Authentication required.");
  return {Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
}

export class AgentApiError extends Error{
  code:string;
  status:number;
  constructor(message:string,code:string,status:number){
    super(message);
    this.name="AgentApiError";
    this.code=code;
    this.status=status;
  }
}

async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const headers={...(await authHeaders()),...(init?.headers||{})};
  const res=await fetch(url,{...init,headers});
  const body=await res.json().catch(()=>({})) as {message?:string;error?:string};
  if(!res.ok) throw new AgentApiError(body.message||body.error||"Request failed",body.error||"AGENT_REQUEST_FAILED",res.status);
  return body as T;
}

export async function listAgents(){
  return api<{agents:AgentRecord[];metrics:Record<string,number>}>("/api/agents");
}
export async function getAgent(id:string){
  return api<any>(`/api/agents/${id}`);
}
export async function createAgent(input:{name:string;slug:string;role_name:string;description?:string}){
  return api<{id:string}>("/api/agents",{method:"POST",body:JSON.stringify(input)});
}
export async function updateAgent(id:string,input:{
  display_name:string;description?:string;channels:string[];confidence_threshold:number;
  working_hours:Record<string,unknown>;daily_limits:Record<string,unknown>;escalation_rules:Record<string,unknown>;
}){
  return api<{ok:true}>(`/api/agents/${id}`,{method:"PATCH",body:JSON.stringify(input)});
}
export async function setAgentStatus(id:string,status:"active"|"paused"|"disabled"){
  const op=status==="active"?"enable":status==="paused"?"pause":"disable";
  return api<{ok:true;status:string}>(`/api/agents/${id}/${op}`,{method:"POST"});
}
export async function executeAgent(
  id:string,
  command:string,
  context?:Record<string,unknown>,
  options?:{mode?:"analyze"|"execute";decision?:unknown;sourceExecutionId?:string}
){
  return api<any>(`/api/agents/${id}/execute`,{
    method:"POST",
    body:JSON.stringify({
      command,
      context:context||{},
      mode:options?.mode||"analyze",
      decision:options?.decision,
      source_execution_id:options?.sourceExecutionId
    })
  });
}
export async function listExecutions(id:string){
  return api<{executions:any[]}>(`/api/agents/${id}/executions`);
}
export async function requestAgentAction(input:{agentId:string;action:AgentCapability;target:{type:string;id?:string|null};payload?:Record<string,unknown>}){
  return api<any>("/api/agent-actions",{method:"POST",body:JSON.stringify(input)});
}
export async function reviewAgentAction(id:string,decision:"approve"|"reject",reason?:string){
  return api<any>(`/api/agent-actions/${id}/${decision}`,{method:"POST",body:JSON.stringify({reason})});
}
