import { withApiErrors } from "../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent,jsonError,serverSupabase } from "../../../../lib/ai/server-supabase";
async function handleGET(req:NextRequest){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const s=serverSupabase(req),q=req.nextUrl.searchParams;
 if(q.get("context")==="1"){const {data,error}=await s.rpc("sav_ai_crm_inbox_context");if(error)return jsonError(error.message,403,"INBOX_CONTEXT_FAILED");return Response.json(data);}
 const {data,error}=await s.rpc("sav_ai_crm_inbox_conversations",{p_search:q.get("search")||null,p_channel:q.get("channel")||null,p_status:q.get("status")||null,p_unread_only:q.get("unread")==="1",p_assignment:q.get("assignment")||null});
 if(error)return jsonError(error.message,403,"INBOX_LIST_FAILED");return Response.json({conversations:data||[]});
}
async function handlePOST(req:NextRequest){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const b=await req.json().catch(()=>null) as null|{channel?:string;subject?:string;leadId?:string;contactId?:string;priority?:string;externalThreadId?:string};
 if(!b?.channel)return jsonError("channel is required",422,"VALIDATION_ERROR");
 const s=serverSupabase(req);const {data:id,error}=await s.rpc("sav_ai_crm_create_conversation",{p_channel:b.channel,p_subject:b.subject||null,p_lead_id:b.leadId||null,p_contact_id:b.contactId||null,p_priority:b.priority||"medium",p_external_thread_id:b.externalThreadId||null});
 if(error)return jsonError(error.message,403,"CONVERSATION_CREATE_FAILED");
 await s.rpc("sav_ai_crm_dispatch_workflow_event",{p_event:"CONVERSATION_CREATED",p_context:{conversation:{id,channel:b.channel,lead_id:b.leadId||null,contact_id:b.contactId||null}},p_event_key:`conversation:${id}:created`});
 return Response.json({id},{status:201});
}
export const GET=withApiErrors(handleGET);
export const POST=withApiErrors(handlePOST);
