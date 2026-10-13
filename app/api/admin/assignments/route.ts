import {NextRequest} from "next/server";
import {adminContext,workspaceAllowed,apiFailure} from "../_admin-context";
import {jsonError} from "../../../../lib/ai/server-supabase";
export async function GET(req:NextRequest){
 const c=await adminContext(req);if("error" in c)return c.error;
 const {data,error}=await c.admin.schema("sav_ai_admin").from("agent_assignments").select("id,workspace_id,agent_id,product_id,role_name,state,created_at").in("workspace_id",c.workspaceIds).order("created_at",{ascending:false}).limit(100);
 return error?apiFailure("Unable to read assignments"):Response.json({assignments:data||[]});
}
export async function POST(req:NextRequest){
 const c=await adminContext(req);if("error" in c)return c.error;
 const body=await req.json().catch(()=>null) as {workspace_id?:string;agent_id?:string;product_id?:string;role_name?:string}|null;
 if(!body?.workspace_id||!workspaceAllowed(c.workspaceIds,body.workspace_id))return jsonError("Invalid workspace",403);
 if(!body.agent_id||!body.product_id||!body.role_name?.trim()||body.role_name.length>100)return jsonError("Invalid assignment",422);
 const [{data:agent},{data:product}]=await Promise.all([
 c.admin.schema("sav_ai_crm").from("ai_agents").select("id").eq("id",body.agent_id).eq("workspace_id",body.workspace_id).maybeSingle(),
 c.admin.schema("sav_ai_admin").from("products").select("id").eq("id",body.product_id).eq("workspace_id",body.workspace_id).maybeSingle()]);
 if(!agent||!product)return jsonError("Agent and product must belong to the same workspace",403);
 const {data,error}=await c.admin.schema("sav_ai_admin").from("agent_assignments").insert({workspace_id:body.workspace_id,agent_id:body.agent_id,product_id:body.product_id,role_name:body.role_name.trim(),state:"draft",allowed_actions:[]}).select("id,state").single();
 if(error)return apiFailure("Assignment could not be saved",409);
 await c.admin.schema("sav_ai_admin").from("admin_audit").insert({workspace_id:body.workspace_id,actor_user_id:c.actor,event_type:"assignment.draft_created",target_type:"assignment",target_id:data.id});
 return Response.json({assignment:data},{status:201});
}
