import { withApiErrors } from "../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../lib/ai/server-supabase";async function handleGET(req:NextRequest){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_notification_channels");if(error)return jsonError(error.message,403,"CHANNELS_FAILED");return Response.json({channels:data||[]});}
export const GET=withApiErrors(handleGET);
