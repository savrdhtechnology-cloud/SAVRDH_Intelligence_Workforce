import { NextRequest } from "next/server";
import { bearerPresent, jsonError, serverSupabase } from "../../../../../lib/ai/server-supabase";

function obj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!bearerPresent(req)) return jsonError("Authentication required", 401, "UNAUTHORIZED");

  const { id } = await params;
  const db = serverSupabase(req);

  const { data: detail, error: detailError } = await db.rpc("sav_ai_crm_task_detail", {
    p_task_id: id,
  });
  if (detailError) return jsonError(detailError.message, 403, "TASK_READ_FAILED");

  const task = obj(obj(detail).task);
  const followupType = String(task.followup_type || "").toLowerCase();
  const title = String(task.title || "").toLowerCase();
  const isEmailTask = followupType === "email" || title.includes("email");

  if (isEmailTask) {
    const endpoint = process.env.ENGAGEX_RUN_EMAIL_TASK_URL?.trim() || "";
    const crmKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
    if (!endpoint || !crmKey) {
      return jsonError(
        "EngageX task email executor is not configured.",
        503,
        "EMAIL_EXECUTOR_NOT_CONFIGURED"
      );
    }

    const authorization = req.headers.get("authorization") || "";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task_id: id, crm_key: crmKey }),
      cache: "no-store",
    });

    const body = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || body.ok !== true) {
      return Response.json(
        {
          error: body.error || "EMAIL_TASK_FAILED",
          message: body.error || "Email task could not be completed.",
          executor: "engagex",
        },
        { status: response.status >= 400 ? response.status : 502 }
      );
    }

    return Response.json({
      ok: true,
      executor: "engagex",
      action: "email_sent",
      provider_message_id: body.provider_message_id || null,
      task_status: body.task_status || "completed",
      lead_status: body.lead_status || null,
    });
  }

  const { data, error } = await db.rpc("sav_ai_crm_run_task_workflow", {
    p_task_id: id,
  });
  if (error) return jsonError(error.message, 409, "WORKFLOW_TASK_FAILED");

  const result = obj(data);
  if (result.ok === false) {
    return Response.json(
      {
        error: result.error || "WORKFLOW_TASK_REJECTED",
        message: result.message || "Task workflow was rejected.",
      },
      { status: 409 }
    );
  }

  return Response.json({ ok: true, executor: "workflow", ...result });
}
