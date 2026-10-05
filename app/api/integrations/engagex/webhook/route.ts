import { withApiErrors } from "../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { jsonError,serverAdminSupabase } from "../../../../../lib/ai/server-supabase";

function safeEqual(a:string,b:string){
  if(a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}

async function handlePOST(req:NextRequest){
  const expected=(process.env.ENGAGEX_WEBHOOK_SECRET||"").trim();
  if(!expected) return jsonError("EngageX webhook is not configured.",503,"ENGAGEX_NOT_CONFIGURED");
  const supplied=(req.headers.get("x-engagex-sync-token")||"").trim();
  if(!supplied||!safeEqual(supplied,expected)) return jsonError("Unauthorized webhook request.",401,"UNAUTHORIZED");
  const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body||!["contact","prospect"].includes(String(body.record_kind||""))||!String(body.record_id||"").trim()||!String(body.name||"").trim()){
    return jsonError("Invalid EngageX payload.",422,"VALIDATION_ERROR");
  }
  const admin=serverAdminSupabase();
  if(!admin) return jsonError("Server database integration is not configured.",503,"DATABASE_NOT_READY");
  const {data,error}=await admin.rpc("sav_ai_crm_ingest_engagex_lead",{p_payload:body});
  if(error){
    console.warn("EngageX webhook ingest failed",{operation:"lead_ingest",code:error.code||null,message:error.message});
    return jsonError("EngageX lead could not be synchronized.",500,"ENGAGEX_INGEST_FAILED");
  }
  return Response.json({ok:true,lead_id:data});
}

export const POST=withApiErrors(handlePOST);
