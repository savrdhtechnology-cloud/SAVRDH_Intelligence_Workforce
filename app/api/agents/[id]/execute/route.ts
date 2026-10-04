import { NextRequest } from "next/server";
import { analyzeSalesLead,executeSalesDecision } from "../../../../../lib/ai/agent-engine";
import { getAIProvider } from "../../../../../lib/ai/provider";
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

export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
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
 if(mode==="execute"&&!body.decision) return jsonError("Analyzed decision is required before execution",422,"VALIDATION_ERROR");

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

 const {data:executionId,error:createError}=await supabase.rpc("sav_ai_crm_create_agent_execution",{
   p_agent_id:id,p_command:executionCommand,p_input:executionInput
 });
 if(createError){
   if(isDatabaseNotReady(createError)) return databaseNotReady(createError.message);
   return jsonError(createError.message,403,"EXECUTION_CREATE_FAILED");
 }

 if(agentSlug==="sav-sales"){
   const engineResult=mode==="analyze"
     ? await analyzeSalesLead({
         supabase,agentId:id,leadId,command:body.command!.trim()
       })
     : await executeSalesDecision({
         supabase,agentId:id,leadId,decision:body.decision
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

   const approvalStatus=engineResult.data.approval_required?"pending":"not_required";
   const {error:completeError}=await supabase.rpc("sav_ai_crm_complete_agent_execution",{
     p_execution_id:executionId,
     p_planned_action:{mode,decision:engineResult.data.decision},
     p_output:{result:engineResult.data,provider:engineResult.provider},
     p_approval_status:approvalStatus
   });
   if(completeError){
     if(isDatabaseNotReady(completeError)) return databaseNotReady(completeError.message);
     return jsonError(completeError.message,500,"EXECUTION_COMPLETE_FAILED");
   }

   return Response.json({
     execution_id:executionId,
     mode,
     status:"completed",
     provider:engineResult.provider,
     result:engineResult.data
   });
 }

 // Preserve the existing provider behavior for non-SAV-Sales agents.
 if(mode==="execute"){
   const {error:failError}=await supabase.rpc("sav_ai_crm_fail_agent_execution",{
     p_execution_id:executionId,p_error:"EXECUTE_MODE_NOT_IMPLEMENTED",
     p_output:{message:"Controlled execute mode is currently enabled only for SAV-Sales."}
   });
   if(failError) return jsonError(failError.message,500,"EXECUTION_STATE_PERSIST_FAILED");
   return jsonError("Controlled execute mode is currently enabled only for SAV-Sales.",409,"EXECUTE_MODE_NOT_IMPLEMENTED");
 }

 const providerContext={...context};
 const {data:leadRows,error:leadError}=await supabase.rpc("sav_ai_crm_list_leads",{p_status:null,p_search:null});
 if(leadError){
   if(isDatabaseNotReady(leadError)) return databaseNotReady(leadError.message);
   return jsonError(leadError.message,500,"LEAD_CONTEXT_LOAD_FAILED");
 }
 const lead=Array.isArray(leadRows)?leadRows.find((item:unknown)=>object(item).id===leadId):null;
 if(lead) providerContext.lead=lead;

 const result=await getAIProvider().planAction({command:body.command!.trim(),context:providerContext});
 if(!result.ok){
   const {error:failError}=await supabase.rpc("sav_ai_crm_fail_agent_execution",{
     p_execution_id:executionId,p_error:result.error,
     p_output:{message:result.message,diagnostic:result.diagnostic}
   });
   if(failError&&isDatabaseNotReady(failError)) return databaseNotReady(failError.message);
   if(failError) return jsonError(failError.message,500,"EXECUTION_STATE_PERSIST_FAILED");
   return Response.json({
     execution_id:executionId,error:result.error,message:result.message,diagnostic:result.diagnostic
   },{status:503});
 }

 const {error:completeError}=await supabase.rpc("sav_ai_crm_complete_agent_execution",{
   p_execution_id:executionId,p_planned_action:result.data,p_output:{plan:result.data},p_approval_status:"not_required"
 });
 if(completeError){
   if(isDatabaseNotReady(completeError)) return databaseNotReady(completeError.message);
   return jsonError(completeError.message,500,"EXECUTION_COMPLETE_FAILED");
 }
 return Response.json({execution_id:executionId,plan:result.data,status:"completed",provider:result.provider});
}
