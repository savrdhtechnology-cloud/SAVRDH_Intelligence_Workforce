import { withApiErrors } from "../../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../../../lib/ai/server-supabase";
async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const b=await req.json().catch(()=>({})) as {read?:boolean};const {error}=await serverSupabase(req).rpc("sav_ai_crm_mark_message_read",{p_message_id:id,p_read:b.read!==false});if(error)return jsonError(error.message,403,"MESSAGE_READ_FAILED");return Response.json({ok:true});}
export const POST=withApiErrors(handlePOST);
