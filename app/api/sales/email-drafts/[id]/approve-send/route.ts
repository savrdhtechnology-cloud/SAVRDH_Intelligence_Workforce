import { NextRequest } from 'next/server';
import { withApiErrors } from '../../../../../../lib/ai/api-errors';
import { bearerPresent,jsonError,serverSupabase,serverAdminSupabase } from '../../../../../../lib/ai/server-supabase';
import { emailConfigured,sendSalesEmail } from '../../../../../../lib/email/send';

async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!bearerPresent(req))return jsonError('Authentication required',401,'UNAUTHORIZED');
 const {id}=await params;
 const db=serverSupabase(req);
 const {data:workspace,error:workspaceError}=await db.rpc('sav_ai_crm_workspace');
 if(workspaceError||!workspace)return jsonError('CRM membership required',403,'FORBIDDEN');
 if(!process.env.EMAIL_WORKSPACE_SLUG||workspace.slug!==process.env.EMAIL_WORKSPACE_SLUG)return jsonError("Sales sender is not connected to this workspace. No email was sent.",503,"EMAIL_WORKSPACE_NOT_CONFIGURED");
 // The existing EngageX bridge only permits AKBS application updates, not sales outreach.
 if(!emailConfigured())return jsonError('EngageX email-send capability is not configured for sales outreach. The connected AKBS transactional bridge cannot send Savrdh sales emails. No email was sent.',503,'EMAIL_NOT_CONFIGURED');
 const admin=serverAdminSupabase();
 if(!admin)return jsonError('Email result recording is not configured. No email was sent.',503,'EMAIL_AUDIT_NOT_CONFIGURED');
 const {data:draft,error}=await db.rpc('sav_ai_crm_claim_sales_email',{p_draft_id:id});
 if(error)return jsonError(error.message,409,'EMAIL_APPROVAL_FAILED');
 const result=await sendSalesEmail({id,recipient:draft.recipient,subject:draft.subject,body:draft.body});
 const {error:recordError}=await admin.rpc('sav_ai_crm_record_sales_email_result',{p_draft_id:id,p_ok:result.ok,p_provider_id:result.ok?result.providerMessageId:null,p_error:result.ok?null:result.code,p_message:result.ok?null:result.message});
 if(recordError)return jsonError(result.ok?'Provider accepted the email, but CRM result recording failed. Do not resend; reconcile provider history.':'Email result could not be saved. Review provider history before retrying.',503,'EMAIL_RESULT_PERSIST_FAILED');
 if(!result.ok)return Response.json({error:result.code,message:result.message,provider:result.provider,status:result.httpStatus,uncertain:result.uncertain},{status:502});
 return Response.json({ok:true,message:'Email accepted by the provider.',send:{ok:true,provider:result.provider,provider_message_id:result.providerMessageId,status:'SENT'}});
}
export const POST=withApiErrors(handlePOST);
