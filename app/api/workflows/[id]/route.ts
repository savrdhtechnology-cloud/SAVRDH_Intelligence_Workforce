import { withApiErrors } from "../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent,jsonError,serverSupabase } from "../../../../lib/ai/server-supabase";
async function handleGET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const {id}=await params; const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_workflow_detail",{p_workflow_id:id});
 if(error)return jsonError(error.message,404,"WORKFLOW_NOT_FOUND"); return Response.json(data);
}
async function handlePATCH(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const {id}=await params; const b=await req.json().catch(()=>null) as null|{name?:string;description?:string;trigger_type?:string;graph?:unknown};
 if(!b?.name||!b.trigger_type||!b.graph)return jsonError("name, trigger_type and graph are required",422,"VALIDATION_ERROR");
 const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_update_workflow",{p_workflow_id:id,p_name:b.name,p_description:b.description||"",p_trigger_type:b.trigger_type,p_graph:b.graph});
 if(error)return jsonError(error.message,403,"WORKFLOW_UPDATE_FAILED"); return Response.json({ok:true,version:data});
}
async function handleDELETE(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const {id}=await params; const {error}=await serverSupabase(req).rpc("sav_ai_crm_archive_workflow",{p_workflow_id:id});
 if(error)return jsonError(error.message,403,"WORKFLOW_ARCHIVE_FAILED"); return Response.json({ok:true});
}

export const GET=withApiErrors(handleGET);
export const PATCH=withApiErrors(handlePATCH);
export const DELETE=withApiErrors(handleDELETE);
