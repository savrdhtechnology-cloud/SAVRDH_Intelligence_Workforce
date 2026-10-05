import { withApiErrors } from "../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../lib/ai/server-supabase";
async function handleGET(req:NextRequest,{params}:{params:Promise<{id:string}>}){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_workflow_execution_detail",{p_execution_id:id});if(error)return jsonError(error.message,404,"WORKFLOW_EXECUTION_NOT_FOUND");return Response.json(data);}
export const GET=withApiErrors(handleGET);
