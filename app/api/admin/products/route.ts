import {NextRequest} from "next/server";
import {adminContext,workspaceAllowed,apiFailure} from "../../_admin-context";
import {jsonError} from "../../../../lib/ai/server-supabase";
export async function GET(req:NextRequest){
 const c=await adminContext(req);if("error" in c)return c.error;
 const {data,error}=await c.admin.schema("sav_ai_admin").from("products").select("id,workspace_id,product_key,name,description,connection_status,created_at").in("workspace_id",c.workspaceIds).order("name").limit(100);
 return error?apiFailure("Unable to read product registry"):Response.json({products:data||[]});
}
export async function POST(req:NextRequest){
 const c=await adminContext(req);if("error" in c)return c.error;
 const body=await req.json().catch(()=>null) as {workspace_id?:string;product_key?:string;name?:string;description?:string}|null;
 if(!body?.workspace_id||!workspaceAllowed(c.workspaceIds,body.workspace_id))return jsonError("Invalid workspace",403);
 if(!body.product_key||!/^[a-z][a-z0-9_-]{2,63}$/.test(body.product_key)||!body.name?.trim()||body.name.length>100)return jsonError("Invalid product name or key",422);
 const {data,error}=await c.admin.schema("sav_ai_admin").from("products").insert({workspace_id:body.workspace_id,product_key:body.product_key,name:body.name.trim(),description:body.description?.slice(0,500)||null,connection_status:"disconnected"}).select("id,product_key,name,connection_status").single();
 if(error)return apiFailure("Product could not be saved",409);
 await c.admin.schema("sav_ai_admin").from("admin_audit").insert({workspace_id:body.workspace_id,actor_user_id:c.actor,event_type:"product.created",target_type:"product",target_id:data.id});
 return Response.json({product:data},{status:201});
}
