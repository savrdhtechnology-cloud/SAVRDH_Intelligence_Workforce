import { withApiErrors } from "../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../../lib/ai/server-supabase";
async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const b=await req.json().catch(()=>({})) as {context?:Record<string,unknown>};const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_test_workflow",{p_workflow_id:id,p_context:b.context||{}});if(error)return jsonError(error.message,403,"WORKFLOW_TEST_FAILED");return Response.json(data);}
export const POST=withApiErrors(handlePOST);
