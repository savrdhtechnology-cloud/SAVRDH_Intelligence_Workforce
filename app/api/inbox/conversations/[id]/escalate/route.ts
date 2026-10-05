import { withApiErrors } from "../../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../../../lib/ai/server-supabase";
async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const b=await req.json().catch(()=>({})) as {reason?:string};const s=serverSupabase(req);
 const {data,error}=await s.rpc("sav_ai_crm_escalate_conversation",{p_conversation_id:id,p_reason:b.reason||"Human assistance requested"});if(error)return jsonError(error.message,403,"ESCALATION_FAILED");
 await s.rpc("sav_ai_crm_dispatch_workflow_event",{p_event:"AI_ESCALATION",p_context:{conversation:{id},escalation:{id:data,reason:b.reason||null}},p_event_key:"conversation:"+id+":escalation:"+data});
 const {data:ctx}=await s.rpc("sav_ai_crm_notification_context");const target=(ctx?.members||[]).find((m:any)=>["owner","admin","manager"].includes(m.role));
 if(target)await s.rpc("sav_ai_crm_create_notification",{p_notification_type:"CONVERSATION_ESCALATION",p_title:"Conversation escalated",p_body:b.reason||"Human assistance requested",p_priority:"high",p_channel:"in_app",p_recipient_member_id:target.id,p_recipient_address:null,p_source_type:"inbox",p_source_id:id,p_deep_link:"/crm/inbox?conversation="+id,p_scheduled_at:null,p_agent_id:null,p_lead_id:null,p_contact_id:null,p_task_id:null,p_workflow_id:null,p_workflow_execution_id:null,p_conversation_id:id,p_metadata:{escalation_id:data},p_idempotency_key:"conversation-escalation:"+data,p_requires_approval:false});
 return Response.json({ok:true,escalation_id:data});
}
export const POST=withApiErrors(handlePOST);
