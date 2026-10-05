import { withApiErrors } from "../../../../../../lib/ai/api-errors";
import { NextRequest } from "next/server";import { bearerPresent,jsonError } from "../../../../../../lib/ai/server-supabase";import { dispatchQueuedMessage } from "../../../../../../lib/channels/message-dispatch";
async function handlePOST(req:NextRequest,{params}:{params:Promise<{id:string}>}){if(!bearerPresent(req))return jsonError("Authentication required",401,"UNAUTHORIZED");const {id}=await params;const result=await dispatchQueuedMessage(req,id);if(!result.ok)return Response.json({error:result.error,message:result.message,message_id:id},{status:result.status});return Response.json(result);}
export const POST=withApiErrors(handlePOST);
