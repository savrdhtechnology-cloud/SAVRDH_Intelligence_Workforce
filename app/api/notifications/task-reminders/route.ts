import { withApiErrors } from "../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../lib/ai/server-supabase";async function handlePOST(req:NextRequest){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_sync_task_notifications");if(error)return jsonError(error.message,403,"TASK_REMINDER_SYNC_FAILED");return Response.json(data||{created:0});}
export const POST=withApiErrors(handlePOST);
