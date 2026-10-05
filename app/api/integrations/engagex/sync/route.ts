import { withApiErrors } from "../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { bearerPresent,jsonError,serverAdminSupabase,serverSupabase } from "../../../../../lib/ai/server-supabase";

function textValue(value:unknown,max=1000){
  return typeof value==="string"?value.trim().slice(0,max):"";
}
function obj(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

async function handlePOST(req:NextRequest){
  if(!bearerPresent(req)) return jsonError("Authentication required",401,"UNAUTHORIZED");

  const crm=serverSupabase(req);
  const {data:workspace,error:workspaceError}=await crm.rpc("sav_ai_crm_workspace");
  if(workspaceError) return jsonError("CRM workspace could not be verified.",403,"WORKSPACE_ACCESS_DENIED");
  const role=textValue(obj(workspace).role,32);
  if(!["owner","admin","manager"].includes(role)||obj(workspace).slug!=="savrdh-technology-main") return jsonError("CRM write permission required.",403,"WORKSPACE_ACCESS_DENIED");

  const engagexUrl=(process.env.ENGAGEX_PROJECT_URL||"").trim();
  const engagexKey=(process.env.ENGAGEX_SERVICE_ROLE_KEY||"").trim();
  if(!engagexUrl||!engagexKey){
    return jsonError("EngageX manual sync is not configured.",503,"ENGAGEX_NOT_CONFIGURED");
  }

  const admin=serverAdminSupabase();
  if(!admin) return jsonError("Server database integration is not configured.",503,"DATABASE_NOT_READY");
  const engagex=createClient(engagexUrl,engagexKey,{auth:{persistSession:false,autoRefreshToken:false}});

  const {data:engagexWorkspaceRow,error:workspaceLookupError}=await engagex
    .from("engagex_workspaces")
    .select("id,slug,name")
    .eq("slug","savrdh-engagex")
    .maybeSingle();
  if(workspaceLookupError||!engagexWorkspaceRow?.id){
    return jsonError("Savrdh Technology EngageX workspace was not found.",503,"ENGAGEX_WORKSPACE_NOT_FOUND");
  }
  const engagexWorkspace=engagexWorkspaceRow.id;

  const [contactResult,prospectResult]=await Promise.all([
    engagex.from("engagex_contacts")
      .select("id,workspace_id,name,first_name,last_name,mobile,email,company,job_title,city,state,country,tags,notes,status,whatsapp_consent,email_consent")
      .eq("workspace_id",engagexWorkspace).eq("status","active").limit(1000),
    engagex.from("engagex_prospects")
      .select("id,workspace_id,business_name,category,location,address,phone,email,website,status,outreach_eligibility,notes,lead_score")
      .eq("workspace_id",engagexWorkspace).eq("status","qualified").limit(1000)
  ]);

  if(contactResult.error||prospectResult.error){
    console.warn("EngageX manual sync source read failed",{
      operation:"engagex_manual_sync",
      contact_code:contactResult.error?.code||null,
      prospect_code:prospectResult.error?.code||null
    });
    return jsonError("EngageX leads could not be loaded.",503,"ENGAGEX_UNAVAILABLE");
  }

  const contacts=(contactResult.data||[]).filter((row:any)=>
    Array.isArray(row.tags)&&row.tags.some((tag:string)=>["qualified","sales-qualified"].includes(String(tag).trim().toLowerCase()))
  );
  const prospects=(prospectResult.data||[]).filter((row:any)=>
    !["do_not_contact","blocked","unsubscribed"].includes(String(row.outreach_eligibility||"").toLowerCase())
  );

  const payloads=[
    ...contacts.map((row:any)=>({
      record_kind:"contact",record_id:row.id,workspace_id:row.workspace_id,
      name:row.name||[row.first_name,row.last_name].filter(Boolean).join(" "),
      phone:row.mobile||null,email:row.email||null,company:row.company||null,
      job_title:row.job_title||null,city:row.city||null,state:row.state||null,country:row.country||null,
      tags:Array.isArray(row.tags)?row.tags:[],notes:row.notes||null,
      email_opt_in:row.email_consent===true,whatsapp_opt_in:row.whatsapp_consent===true,
      source_metadata:{engagex_entity:"contact"}
    })),
    ...prospects.map((row:any)=>({
      record_kind:"prospect",record_id:row.id,workspace_id:row.workspace_id,
      name:row.business_name,phone:row.phone||null,email:row.email||null,
      company:row.business_name||null,industry:row.category||null,website:row.website||null,
      lead_score:typeof row.lead_score==="number"?row.lead_score:null,notes:row.notes||null,
      source_metadata:{engagex_entity:"prospect",location:row.location||null,address:row.address||null,outreach_eligibility:row.outreach_eligibility||null}
    }))
  ].filter((p)=>textValue(p.name,500));

  let synced=0,failed=0;
  for(const payload of payloads){
    const {error}=await admin.rpc("sav_ai_crm_ingest_engagex_lead",{p_payload:payload});
    if(error){
      failed++;
      console.warn("EngageX manual sync ingest failed",{operation:"lead_ingest",code:error.code||null,record_kind:payload.record_kind});
    }else synced++;
  }

  return Response.json({ok:failed===0,found:payloads.length,synced,failed,message:failed?`${synced} leads synchronized; ${failed} failed. Review integration logs before retrying.`:undefined},{status:failed?207:200});
}

export const POST=withApiErrors(handlePOST);
