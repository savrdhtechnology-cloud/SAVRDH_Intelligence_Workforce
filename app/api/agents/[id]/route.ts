import { withApiErrors } from "../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent, jsonError, serverSupabase } from "../../../../lib/ai/server-supabase";

async function handleGET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");
  const {id}=await params;
  const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_agent_detail",{p_agent_id:id});
  if(error) return jsonError(error.message,404,"AGENT_NOT_FOUND");
  return Response.json(data);
}

async function handlePATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");
  const {id}=await params;
  const body=await req.json().catch(()=>null) as null|{
    display_name?:string;description?:string;channels?:string[];confidence_threshold?:number;
    working_hours?:Record<string,unknown>;daily_limits?:Record<string,unknown>;escalation_rules?:Record<string,unknown>
  };
  if(!body?.display_name || typeof body.confidence_threshold!=="number") return jsonError("display_name and confidence_threshold are required",422,"VALIDATION_ERROR");
  const {error}=await serverSupabase(req).rpc("sav_ai_crm_update_agent",{
    p_agent_id:id,p_display_name:body.display_name,p_description:body.description||"",
    p_channels:body.channels||[],p_confidence_threshold:body.confidence_threshold,
    p_working_hours:body.working_hours||{},p_daily_limits:body.daily_limits||{},p_escalation_rules:body.escalation_rules||{}
  });
  if(error) return jsonError(error.message,403,"AGENT_UPDATE_FAILED");
  return Response.json({ok:true});
}

export const GET=withApiErrors(handleGET);
export const PATCH=withApiErrors(handlePATCH);
