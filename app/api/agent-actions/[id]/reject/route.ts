import { withApiErrors } from "../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent,jsonError,serverSupabase } from "../../../../../lib/ai/server-supabase";
async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");
 const {id}=await params; const body=await req.json().catch(()=>({})) as {reason?:string};
 const {error}=await serverSupabase(req).rpc("sav_ai_crm_review_agent_action",{p_action_id:id,p_decision:"rejected",p_reason:body.reason||null});
 if(error) return jsonError(error.message,403,"REJECTION_FAILED");
 return Response.json({ok:true,status:"rejected"});
}

export const POST=withApiErrors(handlePOST);
