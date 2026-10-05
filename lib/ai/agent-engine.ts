import type { SupabaseClient } from "@supabase/supabase-js";
import { getAIProvider } from "./provider";
import { deterministicPlan } from "./deterministic";
import { CRMToolbox, type AgentToolResult } from "./crm-agent-tools";

export type SalesDecision={
  lead_id:string;
  qualification:"hot"|"warm"|"cold"|"unqualified";
  summary:string;
  recommended_product:string|null;
  next_action:string;
  follow_up_required:boolean;
  proposed_actions:Array<{tool:string;payload:Record<string,unknown>}>;
  confidence:number;
};

export type AgentEngineResult={
  decision:SalesDecision;
  actions_taken:AgentToolResult[];
  approval_required:boolean;
  errors:string[];
};

function object(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function stringValue(value:unknown,max=1000){
  return typeof value==="string"?value.trim().slice(0,max):"";
}
function booleanValue(value:unknown){
  return value===true;
}
function nullableString(value:unknown,max=1000){
  const text=stringValue(value,max);
  return text||null;
}

export function normalizeSalesDecision(leadId:string,plan:{payload:Record<string,unknown>;confidence:number}):SalesDecision{
  const payload=object(plan.payload);
  const rawQualification=stringValue(payload.qualification,32).toLowerCase();
  const qualification=(["hot","warm","cold","unqualified"].includes(rawQualification)?rawQualification:"cold") as SalesDecision["qualification"];
  const actions=Array.isArray(payload.proposed_actions)?payload.proposed_actions:[];
  const proposed_actions=actions.slice(0,5).map((raw)=>{
    const item=object(raw);
    const tool=stringValue(item.tool,64);
    const actionPayload:Record<string,unknown>={
      status:nullableString(item.status,32),
      title:nullableString(item.title,160),
      description:nullableString(item.description,1000),
      priority:nullableString(item.priority,20),
      due_at:nullableString(item.due_at,64),
      reminder_at:nullableString(item.reminder_at,64),
      followup_type:nullableString(item.followup_type,40),
      capability:nullableString(item.capability,64)
    };
    return {tool,payload:actionPayload};
  }).filter((item)=>item.tool);

  return {
    lead_id:leadId,
    qualification,
    summary:stringValue(payload.summary,1500),
    recommended_product:nullableString(payload.recommended_product,160),
    next_action:stringValue(payload.next_action,500),
    follow_up_required:booleanValue(payload.follow_up_required),
    proposed_actions,
    confidence:Math.max(0,Math.min(1,Number(plan.confidence)||0))
  };
}

export function validateSalesDecision(value:unknown,leadId:string):SalesDecision{
  const raw=object(value);
  if(raw.lead_id!==leadId) throw new Error("Analysis lead does not match selected lead");
  const qualification=stringValue(raw.qualification,32).toLowerCase();
  if(!["hot","warm","cold","unqualified"].includes(qualification)) throw new Error("Invalid qualification");
  const actions=Array.isArray(raw.proposed_actions)?raw.proposed_actions:[];
  if(actions.length>5) throw new Error("Too many proposed actions");
  const allowedTools=new Set(["updateLeadStatus","createTask","createFollowup","requestApproval"]);
  const proposed_actions=actions.map((entry)=>{
    const item=object(entry);
    const tool=stringValue(item.tool,64);
    if(!allowedTools.has(tool)) throw new Error(`Unsupported proposed tool: ${tool||"unknown"}`);
    return {tool,payload:object(item.payload)};
  });
  return {
    lead_id:leadId,
    qualification:qualification as SalesDecision["qualification"],
    summary:stringValue(raw.summary,1500),
    recommended_product:nullableString(raw.recommended_product,160),
    next_action:stringValue(raw.next_action,500),
    follow_up_required:raw.follow_up_required===true,
    proposed_actions,
    confidence:Math.max(0,Math.min(1,Number(raw.confidence)||0))
  };
}

export async function analyzeSalesLead(input:{
  supabase:SupabaseClient;
  agentId:string;
  leadId:string;
  command:string;
}){
  const tools=new CRMToolbox(input.supabase,input.agentId);
  const leadResult=await tools.getLead(input.leadId);
  if(!leadResult.ok){
    return {ok:false,error:"LEAD_READ_FAILED",message:leadResult.error||"Lead could not be read"} as const;
  }

  const {data:catalog,error:catalogError}=await input.supabase.rpc("sav_ai_crm_active_products");
  if(catalogError){
    return {ok:false,error:"PRODUCT_CATALOG_READ_FAILED",message:catalogError.message} as const;
  }
  const products=Array.isArray(catalog)?catalog:[];
  const explicit=/^(?:create (?:a )?(?:task|follow[ -]?up)|update (?:lead )?status)\s*:/i.test(input.command.trim());
  let provider=explicit?{ok:true as const,data:deterministicPlan(input.command,{lead:leadResult.data}),provider:"deterministic"}:await getAIProvider().planAction({
    command:input.command,
    context:{
      lead:leadResult.data,
      active_products:products,
      mode:"analyze",
      available_tools:["updateLeadStatus","createTask","createFollowup","requestApproval"],
      unavailable_tools:["assignLead","createApplication"],
      constraints:{
        analyze_writes:false,
        no_external_communication:true,
        no_financial_actions:true,
        never_mark_won:true,
        no_arbitrary_sql:true,
        no_environment_access:true
      }
    }
  });
  const diagnostic=provider.ok?null:provider.diagnostic;
  if(!provider.ok){
    provider={ok:true,data:deterministicPlan(input.command,{lead:leadResult.data}),provider:"deterministic"};
  }

  const decision=normalizeSalesDecision(input.leadId,provider.data);
  if(decision.recommended_product && !products.some((p)=>stringValue(object(p).name,160)===decision.recommended_product)){
    decision.recommended_product=null;
  }
  const result:AgentEngineResult={
    decision,
    actions_taken:[],
    approval_required:false,
    errors:[]
  };
  return {ok:true,data:result,provider:provider.provider,diagnostic} as const;
}

export async function executeSalesDecision(input:{
  supabase:SupabaseClient;
  agentId:string;
  leadId:string;
  decision:unknown;
}){
  const tools=new CRMToolbox(input.supabase,input.agentId);
  const leadResult=await tools.getLead(input.leadId);
  if(!leadResult.ok){
    return {ok:false,error:"LEAD_READ_FAILED",message:leadResult.error||"Lead could not be read"} as const;
  }

  let decision:SalesDecision;
  try{
    decision=validateSalesDecision(input.decision,input.leadId);
  }catch(error){
    return {
      ok:false,
      error:"INVALID_AGENT_PLAN",
      message:error instanceof Error?error.message:"Invalid analyzed decision"
    } as const;
  }

  const result:AgentEngineResult={
    decision,
    actions_taken:[],
    approval_required:false,
    errors:[]
  };

  for(const proposed of decision.proposed_actions){
    let toolResult:AgentToolResult;
    if(proposed.tool==="updateLeadStatus"){
      toolResult=await tools.updateLeadStatus(input.leadId,proposed.payload.status);
    }else if(proposed.tool==="createTask"){
      toolResult=await tools.createTask(input.leadId,proposed.payload);
    }else if(proposed.tool==="createFollowup"){
      toolResult=await tools.createFollowup(input.leadId,proposed.payload);
    }else{
      toolResult=await tools.requestApproval(proposed.payload.capability,input.leadId,proposed.payload);
    }
    result.actions_taken.push(toolResult);
    if(toolResult.approval_required) result.approval_required=true;
    if(!toolResult.ok&&toolResult.error) result.errors.push(toolResult.error);
  }

  return {ok:true,data:result,provider:"deterministic-crm-tools"} as const;
}
