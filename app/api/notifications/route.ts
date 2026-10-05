import { withApiErrors } from "../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent,jsonError,serverSupabase } from "../../../lib/ai/server-supabase";
import { dispatchNotification } from "../../../lib/notifications/dispatch";
async function handleGET(req:NextRequest){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const s=serverSupabase(req),q=req.nextUrl.searchParams;
 const args={p_search:q.get("search")||null,p_channel:q.get("channel")||null,p_type:q.get("type")||null,p_status:q.get("status")||null,p_priority:q.get("priority")||null,p_recipient:q.get("recipient")||null,p_source:q.get("source")||null,p_agent:q.get("agent")||null,p_workflow:q.get("workflow")||null,p_read_state:q.get("read")||null,p_date_from:q.get("from")||null,p_date_to:q.get("to")||null};
 const [{data:notifications,error},{data:metrics,error:me},{data:upcoming,error:ue},{data:context,error:ce}]=await Promise.all([s.rpc("sav_ai_crm_notifications",args),s.rpc("sav_ai_crm_notification_metrics"),s.rpc("sav_ai_crm_notification_upcoming"),s.rpc("sav_ai_crm_notification_context")]);
 if(error)return jsonError(error.message,403,"NOTIFICATION_LIST_FAILED");if(me)return jsonError(me.message,403,"NOTIFICATION_METRICS_FAILED");if(ue)return jsonError(ue.message,403,"NOTIFICATION_UPCOMING_FAILED");if(ce)return jsonError(ce.message,403,"NOTIFICATION_CONTEXT_FAILED");
 return Response.json({notifications:notifications||[],metrics:metrics||{},upcoming:upcoming||[],context});
}
async function handlePOST(req:NextRequest){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const b=await req.json().catch(()=>null) as any;if(!b)return jsonError("Invalid request body",422,"VALIDATION_ERROR");const s=serverSupabase(req);
 if(b.agentActionId){
   const {data:id,error}=await s.rpc("sav_ai_crm_queue_approved_agent_notification",{p_action_id:b.agentActionId});if(error)return jsonError(error.message,403,"APPROVED_AI_NOTIFICATION_REJECTED");
   const {data:d}=await s.rpc("sav_ai_crm_notification_detail",{p_notification_id:id});let result:any={ok:true,notification_id:id,status:d?.notification?.status};
   if(d?.notification?.status==="QUEUED")result=await dispatchNotification(req,String(id));
   await s.rpc("sav_ai_crm_finalize_agent_notification",{p_action_id:b.agentActionId,p_notification_id:id,p_ok:result.ok,p_error:result.ok?null:result.message});
   if(!result.ok)return Response.json({error:result.error,message:result.message,notification_id:id,agent_action_id:b.agentActionId},{status:result.status});return Response.json({...result,agent_action_id:b.agentActionId});
 }
 if(b.agentId){
   const {data,error}=await s.rpc("sav_ai_crm_request_agent_action",{p_agent_id:b.agentId,p_action:"SEND_NOTIFICATION",p_target_type:b.targetType||"notification",p_target_id:b.targetId||null,p_payload:{notification_type:b.notificationType||"AI_AGENT_NOTIFICATION",title:b.title,body:b.body,priority:b.priority||"medium",channel:b.channel||"in_app",recipient_member_id:b.recipientMemberId||null,recipient_address:b.recipientAddress||null,deep_link:b.deepLink||null,scheduled_at:b.scheduledAt||null,lead_id:b.leadId||null,contact_id:b.contactId||null,task_id:b.taskId||null,workflow_id:b.workflowId||null,workflow_execution_id:b.workflowExecutionId||null,conversation_id:b.conversationId||null,metadata:b.metadata||{}}});
   if(error)return jsonError(error.message,403,"AGENT_NOTIFICATION_REJECTED");return Response.json(data,{status:202});
 }
 if(!b.notificationType||!b.title||!b.body||!b.channel)return jsonError("notificationType, title, body and channel are required",422,"VALIDATION_ERROR");
 const key=String(b.idempotencyKey||("ui:"+crypto.randomUUID()));
 const {data:id,error}=await s.rpc("sav_ai_crm_create_notification",{p_notification_type:b.notificationType,p_title:b.title,p_body:b.body,p_priority:b.priority||"medium",p_channel:b.channel,p_recipient_member_id:b.recipientMemberId||null,p_recipient_address:b.recipientAddress||null,p_source_type:b.sourceType||"manual",p_source_id:b.sourceId||null,p_deep_link:b.deepLink||null,p_scheduled_at:b.scheduledAt||null,p_agent_id:null,p_lead_id:b.leadId||null,p_contact_id:b.contactId||null,p_task_id:b.taskId||null,p_workflow_id:b.workflowId||null,p_workflow_execution_id:b.workflowExecutionId||null,p_conversation_id:b.conversationId||null,p_metadata:b.metadata||{},p_idempotency_key:key,p_requires_approval:false});
 if(error)return jsonError(error.message,403,"NOTIFICATION_CREATE_FAILED");
 const {data:d}=await s.rpc("sav_ai_crm_notification_detail",{p_notification_id:id});if(d?.notification?.status==="QUEUED"){const result=await dispatchNotification(req,String(id));if(!result.ok)return Response.json({notification_id:id,error:result.error,message:result.message},{status:result.status});return Response.json(result,{status:201});}
 return Response.json({notification_id:id,status:d?.notification?.status||"QUEUED"},{status:201});
}
export const GET=withApiErrors(handleGET);
export const POST=withApiErrors(handlePOST);
