import { withApiErrors } from "../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { analyzeSalesLead,executeSalesDecision } from "../../../../../lib/ai/agent-engine";
import { bearerPresent,jsonError,serverSupabase,supabaseConfigured } from "../../../../../lib/ai/server-supabase";

function isDatabaseNotReady(error:{code?:string|null;message?:string|null}|null|undefined){
 const message=error?.message||"";
 return error?.code==="PGRST202"
   || /Could not find the function .* in the schema cache/i.test(message)
   || /function .* does not exist/i.test(message)
   || /relation .* does not exist/i.test(message)
   || /column .* does not exist/i.test(message);
}

function databaseNotReady(message:string){
 return jsonError(message,503,"DATABASE_NOT_READY");
}

function object(value:unknown):Record<string,unknown>{
 return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");
 if(!supabaseConfigured()) return jsonError("Supabase environment is not configured.",503,"DATABASE_NOT_READY");

 const {id}=await params;
 const body=await req.json().catch(()=>null) as null|{
   command?:string;
   context?:Record<string,unknown>;
   mode?:"analyze"|"execute";
   decision?:unknown;
   source_execution_id?:string;
 };
 if(!body) return jsonError("Request body is required",422,"VALIDATION_ERROR");

 const mode=body.mode==="execute"?"execute":"analyze";
 const context=object(body.context);
 const leadId=typeof context.lead_id==="string"?context.lead_id:"";
 if(!leadId) return jsonError("A CRM lead must be selected",422,"VALIDATION_ERROR");
 if(mode==="analyze"&&!body.command?.trim()) return jsonError("command is required",422,"VALIDATION_ERROR");
 if(mode==="execute"&&!body.source_execution_id) return jsonError("A stored analyzed decision is required before execution",422,"VALIDATION_ERROR");

 const supabase=serverSupabase(req);
 const {data:agentDetail,error:agentError}=await supabase.rpc("sav_ai_crm_agent_detail",{p_agent_id:id});
 if(agentError){
   if(isDatabaseNotReady(agentError)) return databaseNotReady(agentError.message);
   return jsonError(agentError.message,403,"AGENT_READ_FAILED");
 }
 const agent=object(object(agentDetail).agent);
 const agentSlug=typeof agent.slug==="string"?agent.slug:"";
 const agentStatus=typeof agent.status==="string"?agent.status:"";
 if(agentStatus!=="active"){
   return jsonError(
     agentStatus==="paused"?"This agent is paused. Enable it before running work.":"This agent is disabled. Enable it before running work.",
     409,
     "AGENT_NOT_ACTIVE"
   );
 }

 const {data:targetAllowed,error:targetError}=await supabase.rpc("sav_ai_crm_agent_target_allowed",{
   p_agent_id:id,p_lead_id:leadId
 });
 if(targetError){
   if(isDatabaseNotReady(targetError)) return databaseNotReady(targetError.message);
   return jsonError(targetError.message,403,"AGENT_TARGET_CHECK_FAILED");
 }
 if(targetAllowed!==true){
   return jsonError("This lead is outside the current agent testing scope.",409,"TEST_SCOPE_BLOCKED");
 }

 const executionCommand=mode==="analyze"
   ? body.command!.trim()
   : "Execute validated SAV-Sales CRM actions from analyzed decision";
 const executionInput={
   ...context,
   mode,
   source_execution_id:body.source_execution_id||null
 };

 const created=mode==="execute"
   ? await supabase.rpc("sav_ai_crm_claim_agent_plan",{p_source_id:body.source_execution_id,p_agent_id:id,p_lead_id:leadId})
   : await supabase.rpc("sav_ai_crm_create_agent_execution",{p_agent_id:id,p_command:executionCommand,p_input:executionInput});
 const createError=created.error;
 const executionId=mode==="execute"?object(created.data).execution_id:created.data;
 const storedDecision=mode==="execute"?object(created.data).decision:null;
 if(createError){
   if(isDatabaseNotReady(createError)) return databaseNotReady(createError.message);
   return jsonError(createError.message,403,"EXECUTION_CREATE_FAILED");
 }

 {
   const engineResult=mode==="analyze"
     ? await analyzeSalesLead({
         supabase,agentId:id,leadId,command:body.command!.trim()
       })
     : await executeSalesDecision({
         supabase,agentId:id,leadId,decision:storedDecision
       });

   if(!engineResult.ok){
     const output={
       message:engineResult.message,
       diagnostic:"diagnostic" in engineResult?engineResult.diagnostic:null,
       mode
     };
     const {error:failError}=await supabase.rpc("sav_ai_crm_fail_agent_execution",{
       p_execution_id:executionId,p_error:engineResult.error,p_output:output
     });
     if(failError&&isDatabaseNotReady(failError)) return databaseNotReady(failError.message);
     if(failError) return jsonError(failError.message,500,"EXECUTION_STATE_PERSIST_FAILED");
     return Response.json({
       execution_id:executionId,error:engineResult.error,message:engineResult.message,
       diagnostic:"diagnostic" in engineResult?engineResult.diagnostic:null,mode
     },{status:503});
   }

   if(engineResult.data.errors.length){
     const {error}=await supabase.rpc("sav_ai_crm_fail_agent_execution",{p_execution_id:executionId,p_error:"ACTION_EXECUTION_FAILED",p_output:{result:engineResult.data}});
     if(error)return jsonError("Action result could not be persisted. Review activity before retrying.",500,"EXECUTION_STATE_PERSIST_FAILED");
     return Response.json({execution_id:executionId,mode,status:"failed",error:"ACTION_EXECUTION_FAILED",message:engineResult.data.errors.join(" "),result:engineResult.data},{status:409});
   }
   const approvalStatus=engineResult.data.approval_required?"pending":"not_required";
   const {error:completeError}=await supabase.rpc("sav_ai_crm_complete_agent_execution",{
     p_execution_id:executionId,
     p_planned_action:{mode,decision:engineResult.data.decision},
     p_output:{result:engineResult.data,provider:engineResult.provider,diagnostic:"diagnostic" in engineResult?engineResult.diagnostic:null},
     p_approval_status:approvalStatus
   });
   if(completeError){
     if(isDatabaseNotReady(completeError)) return databaseNotReady(completeError.message);
     return jsonError(completeError.message,500,"EXECUTION_COMPLETE_FAILED");
   }

   return Response.json({
     execution_id:executionId,
     mode,
     status:engineResult.data.approval_required?"waiting_approval":"completed",
     provider:engineResult.provider,
     result:engineResult.data
   });
 }

}

export const POST=withApiErrors(handlePOST);
