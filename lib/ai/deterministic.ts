/** Rule-based planning. This module cannot perform writes or network requests. */
export function deterministicPlan(command:string,context:Record<string,unknown>={}){
  const lead=(context.lead||{}) as Record<string,unknown>;
  const title=typeof lead.title==='string'?lead.title:'selected lead';
  // Explicit, deliberately small command grammar. Arbitrary prose is not treated as authorization.
  const task=/^create (?:a )?task\s*:\s*(.{1,160})$/i.exec(command.trim());
  const followup=/^create (?:a )?follow[ -]?up\s*:\s*(.{1,160})$/i.exec(command.trim());
  const status=/^update (?:lead )?status\s*:\s*(new|contacted|qualified|proposal|negotiation|nurture)$/i.exec(command.trim());
  const tool=task?'createTask':followup?'createFollowup':status?'updateLeadStatus':'createTask';
  const action={tool,title:task?.[1]||followup?.[1]||(!status?`Qualify ${title}`.slice(0,160):null),status:status?.[1].toLowerCase()||null,
    description:task||followup||status?null:'Review verified lead information and approved product catalog. Confirm fit and consent with a human before outreach.',
    priority:'medium',due_at:null,reminder_at:null,followup_type:'sales',capability:null};
  return {action:'sav_sales_decision',payload:{qualification:'cold',summary:task||followup||status?'Explicit CRM command parsed. Review the proposed action before Execute.':'No reasoning provider was used. Product fit is not established; a human qualification task is proposed.',recommended_product:null,next_action:action.title||`Set status to ${action.status}`,follow_up_required:Boolean(followup),proposed_actions:[action],external_action_performed:false},confidence:task||followup||status?1:0};
}
export function deterministicSalesEmail(input:{lead:Record<string,unknown>;product:Record<string,unknown>}){
 const name=String(input.lead.title||input.lead.name||'').trim();
 const product=String(input.product.name||'').trim();
 if(!product)throw new Error('An approved product is required.');
 const description=typeof input.product.description==='string'?input.product.description.trim():'';
 const url=typeof input.product.sales_url==='string'&&/^https:\/\//i.test(input.product.sales_url)?input.product.sales_url:'';
 return {subject:`Information about ${product}`.slice(0,500),body:[`Namaste${name?' '+name:''},`,'',`I am contacting you from Savrdh Technology about ${product}.`,description,'Would you like to discuss whether this is suitable for your requirements?',url?'Details: '+url:'','','Regards,','Savrdh Technology','Reply if you do not wish to receive further sales emails.'].filter((v)=>v!==undefined).join('\n'),personalization_summary:'Template uses the saved lead name and approved product record only. No company research or needs were inferred.',confidence:0};
}
