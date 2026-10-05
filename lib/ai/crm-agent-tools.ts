import type { SupabaseClient } from "@supabase/supabase-js";

export type AgentToolName="getLead"|"updateLeadStatus"|"createTask"|"createFollowup"|"requestApproval";

export type AgentToolResult={
  tool:AgentToolName;
  ok:boolean;
  action_id?:string;
  task_id?:string|null;
  approval_required?:boolean;
  data?:unknown;
  error?:string;
};

const SAFE_LEAD_STATUSES=new Set(["new","contacted","qualified","proposal","negotiation","nurture"]);

function asObject(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function nonEmptyString(value:unknown,max=500){
  if(typeof value!=="string") return null;
  const trimmed=value.trim();
  if(!trimmed) return null;
  return trimmed.slice(0,max);
}
function optionalIso(value:unknown){
  const text=nonEmptyString(value,64);
  if(!text) return null;
  const date=new Date(text);
  if(Number.isNaN(date.getTime())) throw new Error("Invalid date/time");
  return date.toISOString();
}

export class CRMToolbox{
  constructor(
    private readonly supabase:SupabaseClient,
    private readonly agentId:string
  ){}

  private async logTool(result:AgentToolResult,targetType:string|null,targetId:string|null){
    const {error}=await this.supabase.rpc("sav_ai_crm_log_agent_tool",{
      p_agent_id:this.agentId,
      p_tool:result.tool,
      p_success:result.ok,
      p_target_type:targetType,
      p_target_id:targetId,
      p_error:result.error||null,
      p_metadata:{
        action_id:result.action_id||null,
        task_id:result.task_id||null,
        approval_required:result.approval_required===true
      }
    });
    if(error)return {...result,ok:false,error:"Operation result could not be audited. Refresh its record before retrying."};
    return result;
  }

  private async workspaceRole(){
    const {data,error}=await this.supabase.rpc("sav_ai_crm_workspace");
    if(error) throw new Error(error.message);
    const role=asObject(data).role;
    return typeof role==="string"?role:"";
  }

  private async ensureWriteRole(){
    const role=await this.workspaceRole();
    if(!role||role==="viewer") throw new Error("CRM write permission required");
  }

  private async ensureCapability(capability:string){
    const {data,error}=await this.supabase.rpc("sav_ai_crm_agent_detail",{p_agent_id:this.agentId});
    if(error) throw new Error(error.message);
    const detail=asObject(data);
    const rows=Array.isArray(detail.capabilities)?detail.capabilities:[];
    const enabled=rows.some((row)=>{
      const item=asObject(row);
      return item.capability===capability&&item.is_enabled!==false;
    });
    if(!enabled) throw new Error(`Agent capability denied: ${capability}`);
  }

  async getLead(leadId:string):Promise<AgentToolResult>{
    if(!/^[0-9a-f-]{36}$/i.test(leadId)){
      return this.logTool({tool:"getLead",ok:false,error:"Invalid lead ID"},"lead",null);
    }
    const {data,error}=await this.supabase.rpc("sav_ai_crm_lead_sales_detail",{p_lead_id:leadId});
    if(error)return {tool:"getLead",ok:false,error:error.message};
    const lead=asObject(data).lead;
    if(!lead)return {tool:"getLead",ok:false,error:"Lead not found in workspace"};
    return {tool:"getLead",ok:true,data:lead};
  }

  private async requestAndExecute(
    tool:AgentToolName,
    capability:string,
    leadId:string,
    payload:Record<string,unknown>
  ):Promise<AgentToolResult>{
    try{
      await this.ensureWriteRole();
      await this.ensureCapability(capability);
      const requested=await this.supabase.rpc("sav_ai_crm_request_agent_action",{
        p_agent_id:this.agentId,
        p_action:capability,
        p_target_type:"lead",
        p_target_id:leadId,
        p_payload:payload
      });
      if(requested.error) return this.logTool({tool,ok:false,error:requested.error.message},"lead",leadId);
      const requestData=asObject(requested.data);
      const actionId=typeof requestData.action_id==="string"?requestData.action_id:undefined;
      const approvalRequired=requestData.approval_required===true;
      if(!actionId) return this.logTool({tool,ok:false,error:"Agent action request did not return an action ID"},"lead",leadId);
      if(approvalRequired){
        return this.logTool({
          tool,ok:true,action_id:actionId,approval_required:true,data:requestData
        },"lead",leadId);
      }

      const executed=await this.supabase.rpc("sav_ai_crm_execute_agent_action",{p_action_id:actionId});
      if(executed.error){
        return this.logTool({tool,ok:false,action_id:actionId,error:executed.error.message},"lead",leadId);
      }
      const result=asObject(executed.data);
      return this.logTool({
        tool,
        ok:true,
        action_id:actionId,
        task_id:typeof result.task_id==="string"?result.task_id:null,
        approval_required:false,
        data:result
      },"lead",leadId);
    }catch(error){
      return this.logTool({
        tool,ok:false,error:error instanceof Error?error.message:"Agent action failed"
      },"lead",leadId);
    }
  }

  async updateLeadStatus(leadId:string,status:unknown):Promise<AgentToolResult>{
    const next=nonEmptyString(status,32);
    if(!next||!SAFE_LEAD_STATUSES.has(next)){
      return this.logTool({
        tool:"updateLeadStatus",ok:false,error:"Lead status is not permitted for autonomous agent update"
      },"lead",leadId);
    }
    return this.requestAndExecute("updateLeadStatus","UPDATE_LEAD",leadId,{status:next});
  }

  async createTask(leadId:string,rawPayload:unknown):Promise<AgentToolResult>{
    const payload=asObject(rawPayload);
    const title=nonEmptyString(payload.title,160);
    if(!title) return this.logTool({tool:"createTask",ok:false,error:"Task title is required"},"lead",leadId);
    const priority=nonEmptyString(payload.priority,20)||"medium";
    if(!["low","medium","high","urgent"].includes(priority)){
      return this.logTool({tool:"createTask",ok:false,error:"Invalid task priority"},"lead",leadId);
    }
    try{
      return this.requestAndExecute("createTask","CREATE_TASK",leadId,{
        title,
        description:nonEmptyString(payload.description,1000),
        priority,
        due_at:optionalIso(payload.due_at),
        reminder_at:optionalIso(payload.reminder_at)
      });
    }catch(error){
      return this.logTool({tool:"createTask",ok:false,error:error instanceof Error?error.message:"Task validation failed"},"lead",leadId);
    }
  }

  async createFollowup(leadId:string,rawPayload:unknown):Promise<AgentToolResult>{
    const payload=asObject(rawPayload);
    const title=nonEmptyString(payload.title,160)||"Sales follow-up";
    const priority=nonEmptyString(payload.priority,20)||"medium";
    if(!["low","medium","high","urgent"].includes(priority)){
      return this.logTool({tool:"createFollowup",ok:false,error:"Invalid follow-up priority"},"lead",leadId);
    }
    try{
      return this.requestAndExecute("createFollowup","CREATE_FOLLOWUP",leadId,{
        title,
        description:nonEmptyString(payload.description,1000),
        priority,
        due_at:optionalIso(payload.due_at),
        reminder_at:optionalIso(payload.reminder_at),
        followup_type:nonEmptyString(payload.followup_type,40)||"sales"
      });
    }catch(error){
      return this.logTool({tool:"createFollowup",ok:false,error:error instanceof Error?error.message:"Follow-up validation failed"},"lead",leadId);
    }
  }

  async requestApproval(capabilityValue:unknown,leadId:string,payloadValue:unknown):Promise<AgentToolResult>{
    const capability=nonEmptyString(capabilityValue,64);
    if(!capability) return this.logTool({tool:"requestApproval",ok:false,error:"Capability is required"},"lead",leadId);
    try{
      await this.ensureWriteRole();
      await this.ensureCapability(capability);
      const {data,error}=await this.supabase.rpc("sav_ai_crm_request_agent_action",{
        p_agent_id:this.agentId,
        p_action:capability,
        p_target_type:"lead",
        p_target_id:leadId,
        p_payload:asObject(payloadValue)
      });
      if(error) return this.logTool({tool:"requestApproval",ok:false,error:error.message},"lead",leadId);
      const result=asObject(data);
      return this.logTool({
        tool:"requestApproval",
        ok:true,
        action_id:typeof result.action_id==="string"?result.action_id:undefined,
        approval_required:result.approval_required===true,
        data:result
      },"lead",leadId);
    }catch(error){
      return this.logTool({
        tool:"requestApproval",ok:false,error:error instanceof Error?error.message:"Approval request failed"
      },"lead",leadId);
    }
  }
}
