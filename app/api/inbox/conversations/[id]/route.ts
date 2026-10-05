import { withApiErrors } from "../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent,jsonError,serverSupabase } from "../../../../../lib/ai/server-supabase";
async function handleGET(req:NextRequest,{params}:{params:Promise<{id:string}>}){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_inbox_conversation_detail",{p_conversation_id:id});if(error)return jsonError(error.message,404,"CONVERSATION_NOT_FOUND");return Response.json(data);}
async function handlePATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const b=await req.json().catch(()=>({})) as any;const s=serverSupabase(req);
 if(typeof b.internalNote==="string"){const {data,error}=await s.rpc("sav_ai_crm_add_internal_note",{p_conversation_id:id,p_body:b.internalNote});if(error)return jsonError(error.message,403,"NOTE_CREATE_FAILED");return Response.json({ok:true,message_id:data});}
 const {error}=await s.rpc("sav_ai_crm_update_conversation",{p_conversation_id:id,p_priority:b.priority??null,p_lead_id:b.leadId??null,p_contact_id:b.contactId??null,p_subject:b.subject??null,p_tags:Array.isArray(b.tags)?b.tags:null,p_mark_unread:typeof b.markUnread==="boolean"?b.markUnread:null,p_archive:typeof b.archive==="boolean"?b.archive:null});
 if(error)return jsonError(error.message,403,"CONVERSATION_UPDATE_FAILED");return Response.json({ok:true});}
export const GET=withApiErrors(handleGET);
export const PATCH=withApiErrors(handlePATCH);
