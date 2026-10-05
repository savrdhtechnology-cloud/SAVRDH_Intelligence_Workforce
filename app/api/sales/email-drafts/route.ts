import { withApiErrors } from "../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { deterministicSalesEmail } from "../../../../lib/ai/deterministic";
import { getAIProvider } from "../../../../lib/ai/provider";
import { bearerPresent,jsonError,serverSupabase } from "../../../../lib/ai/server-supabase";

function obj(v:unknown):Record<string,unknown>{return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};}

async function handlePOST(req:NextRequest){
  if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");
  const body=await req.json().catch(()=>null) as null|{leadId?:string;agentId?:string;productId?:string;need?:string};
  if(!body?.leadId||!body.agentId) return jsonError("leadId and agentId are required",422,"VALIDATION_ERROR");
  const db=serverSupabase(req);
  const [{data:detail,error:detailError},{data:products,error:productError}]=await Promise.all([
    db.rpc("sav_ai_crm_lead_sales_detail",{p_lead_id:body.leadId}),
    db.rpc("sav_ai_crm_active_products")
  ]);
  if(detailError) return jsonError(detailError.message,403,"LEAD_READ_FAILED");
  if(productError) return jsonError(productError.message,503,"PRODUCT_CATALOG_READ_FAILED");
  const lead=obj(obj(detail).lead);
  const email=typeof lead.email==="string"?lead.email.trim():"";
  if(!email) return jsonError("Lead email is missing.",409,"EMAIL_MISSING");
  if(lead.email_opt_in!==true) return jsonError("Email consent is missing.",409,"EMAIL_CONSENT_MISSING");
  const rows=Array.isArray(products)?products:[];
  const productId=body.productId|| (typeof lead.ai_recommended_product_id==="string"?lead.ai_recommended_product_id:"");
  const product=rows.find((p)=>obj(p).id===productId);
  if(!product) return jsonError("Supported active product fit is required.",409,"PRODUCT_FIT_MISSING");
  const qualification=typeof lead.ai_qualification==="string"?lead.ai_qualification:"";
  let generated=await getAIProvider().generateSalesEmail({
    lead,product:obj(product),qualification,need:(body.need||"").trim().slice(0,1000)
  });
  if(!generated.ok)generated={ok:true,data:deterministicSalesEmail({lead,product:obj(product)}),provider:"deterministic"};
  const {data:saved,error:saveError}=await db.rpc("sav_ai_crm_save_sales_email_draft",{
    p_lead_id:body.leadId,p_agent_id:body.agentId,p_product_id:productId,p_recipient:email,
    p_subject:generated.data.subject,p_body:generated.data.body,p_personalization_summary:generated.data.personalization_summary,
    p_confidence:generated.data.confidence
  });
  if(saveError) return jsonError(saveError.message,409,"EMAIL_DRAFT_FAILED");
  if(saved?.ok===false)return jsonError(saved.message||"Duplicate draft prevented.",409,saved.error||"EMAIL_DRAFT_FAILED");
  return Response.json({provider:generated.provider,draft:saved,email:{recipient:email,...generated.data},product:obj(product)});
}

export const POST=withApiErrors(handlePOST);
