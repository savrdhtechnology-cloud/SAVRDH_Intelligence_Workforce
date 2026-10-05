import { withApiErrors } from "../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { AgentCapability, ACTION_RISK, requiresHumanApproval } from "../../crm/agents/agent-types";
import { bearerPresent,jsonError,serverSupabase } from "../../../lib/ai/server-supabase";

async function handlePOST(req:NextRequest){
 if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");
 const body=await req.json().catch(()=>null) as null|{agentId?:string;action?:AgentCapability;target?:{type?:string;id?:string|null};payload?:Record<string,unknown>};
 if(!body?.agentId || !body.action || !body.target?.type) return jsonError("agentId, action and target.type are required",422,"VALIDATION_ERROR");
 if(!(body.action in ACTION_RISK)) return jsonError("Unsupported capability",422,"VALIDATION_ERROR");
 const supabase=serverSupabase(req);
 const {data,error}=await supabase.rpc("sav_ai_crm_request_agent_action",{
   p_agent_id:body.agentId,p_action:body.action,p_target_type:body.target.type,p_target_id:body.target.id||null,p_payload:body.payload||{}
 });
 if(error) return jsonError(error.message,403,"AGENT_ACTION_REJECTED");
 if(data?.approval_required || requiresHumanApproval(body.action,ACTION_RISK[body.action])) return Response.json(data,{status:202});
 const {data:executed,error:executeError}=await supabase.rpc("sav_ai_crm_execute_agent_action",{p_action_id:data.action_id});
 if(executeError) return jsonError(executeError.message,409,"AGENT_ACTION_FAILED");
 return Response.json(executed);
}

export const POST=withApiErrors(handlePOST);
