export type EmailInput={id:string;recipient:string;subject:string;body:string};
export type EmailResult={ok:true;provider:'resend';providerMessageId:string;status:'SENT'}|{ok:false;provider:'resend';httpStatus:number|null;code:string;message:string;uncertain:boolean};
export function emailConfigured(){return process.env.EMAIL_PROVIDER==='resend'&&Boolean(process.env.EMAIL_API_KEY?.trim()&&process.env.EMAIL_FROM?.trim());}
export async function sendSalesEmail(input:EmailInput,send:typeof fetch=fetch):Promise<EmailResult>{
 const fail=(code:string,message:string,httpStatus:number|null=null,uncertain=false):EmailResult=>({ok:false,provider:'resend',httpStatus,code,message,uncertain});
 if(!emailConfigured())return fail('EMAIL_NOT_CONFIGURED','Sales email sender is not configured. No email was sent.');
 if(!/^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/.test(input.recipient)||!input.subject.trim()||/[\r\n]/.test(input.subject)||!input.body.trim())return fail('EMAIL_INVALID_INPUT','Recipient, subject or body is invalid. No email was sent.',422);
 try{
  const response=await send('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${process.env.EMAIL_API_KEY}`, 'Content-Type':'application/json','Idempotency-Key':`sav-sales-${input.id}`},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[input.recipient],subject:input.subject,text:input.body})});
  const body=await response.json().catch(()=>null);
  if(!response.ok)return fail('EMAIL_PROVIDER_REJECTED',`Email was not confirmed by Resend (HTTP ${response.status}). ${response.status>=500?'Check provider history before retrying.':'No successful acceptance was returned.'}`,response.status,response.status>=500);
  if(body?.id&&typeof body.id==='string')return {ok:true,provider:'resend',providerMessageId:body.id,status:'SENT'};
  return fail('EMAIL_ACCEPTANCE_UNKNOWN','Provider response had no message ID. Delivery status is unknown; check provider history before retrying.',response.status,true);
 }catch{return fail('EMAIL_ACCEPTANCE_UNKNOWN','Email provider could not be reached or timed out. Acceptance is unknown; check history before retrying.',null,true);}
}
