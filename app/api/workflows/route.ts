import { withApiErrors } from "../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { bearerPresent,jsonError,serverSupabase } from "../../../lib/ai/server-supabase";
async function handleGET(req:NextRequest){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const s=serverSupabase(req);
 const [{data:workflows,error},{data:metrics,error:me},{data:templates,error:te}]=await Promise.all([
   s.rpc("sav_ai_crm_workflow_registry"),s.rpc("sav_ai_crm_workflow_metrics"),s.rpc("sav_ai_crm_workflow_templates")
 ]);
 if(error)return jsonError(error.message,403,"WORKFLOW_LIST_FAILED");
 if(me)return jsonError(me.message,403,"WORKFLOW_METRICS_FAILED");
 if(te)return jsonError(te.message,403,"WORKFLOW_TEMPLATES_FAILED");
 return Response.json({workflows:workflows||[],metrics:metrics||{},templates:templates||[]});
}
async function handlePOST(req:NextRequest){
 if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");
 const body=await req.json().catch(()=>null) as null|{name?:string;description?:string;trigger_type?:string;graph?:unknown;template_id?:string|null};
 if(!body?.name||!body.trigger_type||!body.graph)return jsonError("name, trigger_type and graph are required",422,"VALIDATION_ERROR");
 const {data,error}=await serverSupabase(req).rpc("sav_ai_crm_create_workflow",{
  p_name:body.name,p_description:body.description||"",p_trigger_type:body.trigger_type,p_graph:body.graph,p_template_id:body.template_id||null
 });
 if(error)return jsonError(error.message,403,"WORKFLOW_CREATE_FAILED");
 return Response.json({id:data},{status:201});
}

export const GET=withApiErrors(handleGET);
export const POST=withApiErrors(handlePOST);
