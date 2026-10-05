import { crmFetch } from "../request";
import { crmSupabase } from "../supabase-client";
import { WorkflowGraph, WorkflowRecord } from "./workflow-types";

async function headers(){
  const {data}=await crmSupabase.auth.getSession();
  const token=data.session?.access_token;
  if(!token)throw new Error("Authentication required.");
  return {Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
}
async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const res=await crmFetch(url,{...init,headers:{...(await headers()),...(init?.headers||{})}});
  const body=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(body.message||body.error||"Workflow request failed");
  return body as T;
}
export const listWorkflows=()=>api<{workflows:WorkflowRecord[];metrics:Record<string,unknown>;templates:any[]}>("/api/workflows");
export const getWorkflow=(id:string)=>api<any>(`/api/workflows/${id}`);
export const createWorkflow=(input:{name:string;description?:string;trigger_type:string;graph:WorkflowGraph;template_id?:string|null})=>
  api<{id:string}>("/api/workflows",{method:"POST",body:JSON.stringify(input)});
export const updateWorkflow=(id:string,input:{name:string;description?:string;trigger_type:string;graph:WorkflowGraph})=>
  api<{ok:true;version:number}>(`/api/workflows/${id}`,{method:"PATCH",body:JSON.stringify(input)});
export const deleteWorkflow=(id:string)=>api<{ok:true}>(`/api/workflows/${id}`,{method:"DELETE"});
export const workflowStatus=(id:string,op:"enable"|"pause"|"disable")=>api<any>(`/api/workflows/${id}/${op}`,{method:"POST"});
export const duplicateWorkflow=(id:string)=>api<{id:string}>(`/api/workflows/${id}/duplicate`,{method:"POST"});
export const testWorkflow=(id:string,context:Record<string,unknown>)=>api<any>(`/api/workflows/${id}/test`,{method:"POST",body:JSON.stringify({context})});
export const executeWorkflow=(id:string,context:Record<string,unknown>,idempotencyKey?:string)=>api<any>(`/api/workflows/${id}/execute`,{method:"POST",body:JSON.stringify({context,idempotency_key:idempotencyKey})});
export const listWorkflowExecutions=(id:string)=>api<any>(`/api/workflows/${id}/executions`);
export const getWorkflowExecution=(id:string)=>api<any>(`/api/workflow-executions/${id}`);
export const reviewWorkflowApproval=(id:string,decision:"approve"|"reject",reason?:string)=>api<any>(`/api/workflow-approvals/${id}/${decision}`,{method:"POST",body:JSON.stringify({reason})});
