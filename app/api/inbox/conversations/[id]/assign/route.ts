import { withApiErrors } from "../../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError,serverSupabase } from "../../../../../../lib/ai/server-supabase";
async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const b=await req.json().catch(()=>({})) as any;const s=serverSupabase(req);
 const {error}=await s.rpc("sav_ai_crm_assign_conversation",{p_conversation_id:id,p_assignment_type:b.assignmentType,p_member_id:b.memberId||null,p_agent_id:b.agentId||null,p_reason:b.reason||null});if(error)return jsonError(error.message,403,"ASSIGNMENT_FAILED");
 await s.rpc("sav_ai_crm_dispatch_workflow_event",{p_event:"CONVERSATION_ASSIGNED",p_context:{conversation:{id},assignment:{type:b.assignmentType,member_id:b.memberId||null,agent_id:b.agentId||null}},p_event_key:"conversation:"+id+":assigned:"+(b.memberId||b.agentId||"none")});
 if(b.assignmentType==="human"&&b.memberId){await s.rpc("sav_ai_crm_create_notification",{p_notification_type:"CONVERSATION_ASSIGNMENT",p_title:"Conversation assigned to you",p_body:b.reason||"A conversation has been assigned to you.",p_priority:"medium",p_channel:"in_app",p_recipient_member_id:b.memberId,p_recipient_address:null,p_source_type:"inbox",p_source_id:id,p_deep_link:"/crm/inbox?conversation="+id,p_scheduled_at:null,p_agent_id:null,p_lead_id:null,p_contact_id:null,p_task_id:null,p_workflow_id:null,p_workflow_execution_id:null,p_conversation_id:id,p_metadata:{assignment_type:"human"},p_idempotency_key:"conversation-assignment:"+id+":"+b.memberId+":"+Date.now(),p_requires_approval:false});}
 return Response.json({ok:true});
}
export const POST=withApiErrors(handlePOST);
