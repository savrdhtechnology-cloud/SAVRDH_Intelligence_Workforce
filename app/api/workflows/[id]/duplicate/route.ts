import { withApiErrors } from "../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../../lib/ai/server-supabase";
async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_duplicate_workflow",{p_workflow_id:id});if(error)return jsonError(error.message,403,"WORKFLOW_DUPLICATE_FAILED");return Response.json({id:data},{status:201});}
export const POST=withApiErrors(handlePOST);
