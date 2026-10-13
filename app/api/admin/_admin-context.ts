import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { jsonError, serverAdminSupabase, serverSupabase, bearerPresent } from "../../../lib/ai/server-supabase";

export async function adminContext(req:NextRequest){
 if(!bearerPresent(req))return {error:jsonError("Sign in required",401,"UNAUTHORIZED")} as const;
 const auth=serverSupabase(req);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 const {data:{user},error:userError}=await auth.auth.getUser(token);
 if(userError||!user)return {error:jsonError("Invalid session",401,"UNAUTHORIZED")} as const;
 const admin=serverAdminSupabase();
 if(!admin)return {error:jsonError("Private admin database connection not configured",503,"ADMIN_DB_UNAVAILABLE")} as const;
 const {data:members,error:memberError}=await admin.schema("sav_ai_crm").from("members").select("workspace_id,role").eq("user_id",user.id).eq("is_active",true).in("role",["owner","admin","manager"]);
 if(memberError)return {error:jsonError("Admin membership lookup failed",503,"ADMIN_MEMBERSHIP_ERROR")} as const;
 if(!members?.length)return {error:jsonError("Admin access required",403,"FORBIDDEN")} as const;
 return {admin,actor:user.id,workspaceIds:members.map(m=>m.workspace_id as string)} as const;
}
export function workspaceAllowed(workspaces:readonly string[],workspaceId:string){
 return workspaces.includes(workspaceId);
}
export function apiFailure(message:string,status=500){return jsonError(message,status,"ADMIN_STORAGE_ERROR")}
