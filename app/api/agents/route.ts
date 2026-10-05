import { withApiErrors } from "../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent, jsonError, serverSupabase } from "../../../lib/ai/server-supabase";

async function handleGET(req:NextRequest){
  if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");
  const supabase=serverSupabase(req);
  const [{data:agents,error},{data:metrics,error:metricError}] = await Promise.all([
    supabase.rpc("sav_ai_crm_agent_registry"),
    supabase.rpc("sav_ai_crm_agent_metrics")
  ]);
  if(error) return jsonError(error.message,403,"AGENT_REGISTRY_FAILED");
  if(metricError) return jsonError(metricError.message,403,"AGENT_METRICS_FAILED");
  return Response.json({agents:agents||[],metrics:metrics||{}});
}

async function handlePOST(req:NextRequest){
  if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");
  const body=await req.json().catch(()=>null) as null|{name?:string;slug?:string;role_name?:string;description?:string};
  if(!body?.name || !body.slug || !body.role_name) return jsonError("name, slug and role_name are required",422,"VALIDATION_ERROR");
  const supabase=serverSupabase(req);
  const {data,error}=await supabase.rpc("sav_ai_crm_create_agent",{
    p_name:body.name,p_slug:body.slug,p_role_name:body.role_name,p_description:body.description||null
  });
  if(error) return jsonError(error.message,403,"AGENT_CREATE_FAILED");
  return Response.json({id:data},{status:201});
}

export const GET=withApiErrors(handleGET);
export const POST=withApiErrors(handlePOST);
