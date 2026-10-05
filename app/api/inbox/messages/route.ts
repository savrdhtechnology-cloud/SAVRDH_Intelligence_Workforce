import { withApiErrors } from "../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent,jsonError,serverSupabase } from "../../../../lib/ai/server-supabase";
import { dispatchQueuedMessage } from "../../../../lib/channels/message-dispatch";

async function handlePOST(req:NextRequest){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const b=await req.json().catch(()=>null) as null|{
   conversationId?:string;body?:string;messageType?:string;recipient?:string;agentId?:string;attachments?:unknown[];
   agentActionId?:string;
 };
 if(!b)return jsonError("Invalid request body",422,"VALIDATION_ERROR");
 const s=serverSupabase(req);

 if(b.agentActionId){
   const {data:queued,error:queueError}=await s.rpc("sav_ai_crm_queue_approved_agent_message",{p_action_id:b.agentActionId});
   if(queueError)return jsonError(queueError.message,403,"APPROVED_AI_SEND_REJECTED");
   const messageId=String(queued.message_id);
   const result=await dispatchQueuedMessage(req,messageId);
   await s.rpc("sav_ai_crm_finalize_agent_message_action",{
     p_action_id:b.agentActionId,p_message_id:messageId,p_ok:result.ok,p_error:result.ok?null:result.message
   });
   if(!result.ok)return Response.json({error:result.error,message:result.message,message_id:messageId,agent_action_id:b.agentActionId},{status:result.status});
   return Response.json({...result,agent_action_id:b.agentActionId});
 }

 if(!b.conversationId)return jsonError("conversationId is required",422,"VALIDATION_ERROR");
 const {data,error}=await s.rpc("sav_ai_crm_queue_outbound_message",{
   p_conversation_id:b.conversationId,p_body:b.body||"",p_message_type:b.messageType||"text",
   p_recipient:b.recipient||null,p_agent_id:b.agentId||null,p_attachments:Array.isArray(b.attachments)?b.attachments:[]
 });
 if(error)return jsonError(error.message,403,"MESSAGE_QUEUE_FAILED");
 if(data?.approval_required)return Response.json(data,{status:202});
 const result=await dispatchQueuedMessage(req,String(data.message_id));
 if(!result.ok)return Response.json({error:result.error,message:result.message,message_id:result.message_id},{status:result.status});
 return Response.json(result,{status:201});
}

export const POST=withApiErrors(handlePOST);
