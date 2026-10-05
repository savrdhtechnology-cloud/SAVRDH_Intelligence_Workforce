import { withApiErrors } from "../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../../lib/ai/server-supabase";
async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const {error}=await serverSupabase(req).rpc("sav_ai_crm_set_workflow_status",{p_workflow_id:id,p_status:"active"});if(error)return jsonError(error.message,403,"WORKFLOW_STATUS_FAILED");return Response.json({ok:true,status:"active"});}
export const POST=withApiErrors(handlePOST);
