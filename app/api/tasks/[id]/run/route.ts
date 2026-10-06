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
    const resendKey = process.env.AKBS_WORKFORCE_RESEND_API_KEY?.trim() || "";
    if (!resendKey) {
      return jsonError("AKBS Workforce email sender is not configured.", 503, "EMAIL_SENDER_NOT_CONFIGURED");
    }

    if (!task.assigned_agent_id) {
      return jsonError("Task is not assigned to an AI agent.", 409, "NO_AGENT");
    }

    const { data: agent, error: agentError } = await db
      .schema("sav_ai_crm")
      .from("ai_agents")
      .select("status")
      .eq("id", task.assigned_agent_id)
      .maybeSingle();
    if (agentError || !agent) {
      return jsonError("Assigned AI agent was not found.", 409, "AGENT_NOT_FOUND");
    }
    if (agent.status !== "active") {
      return jsonError("Assigned AI agent is paused or disabled.", 409, "AGENT_NOT_ACTIVE");
    }

    if (!task.lead_id) return jsonError("Task is not linked to a lead.", 409, "NO_LEAD");

    const { data: leadDetail, error: leadError } = await db.rpc("sav_ai_crm_lead_sales_detail", {
      p_lead_id: task.lead_id,
    });
    if (leadError) return jsonError(leadError.message, 403, "LEAD_READ_FAILED");

    const lead = obj(obj(leadDetail).lead);
    const metadata = obj(lead.metadata);
    const recipient = String(lead.email || "").trim().toLowerCase();
    if (!recipient) return jsonError("Lead email is missing.", 409, "LEAD_EMAIL_MISSING");

    const feeTask = String(task.notes || "").includes("fee-gate:auto")
      || title.includes("fee payment follow-up");

    if (feeTask && String(metadata.fee_status || "").toUpperCase() === "VERIFIED") {
      const { error: doneError } = await db.rpc("sav_ai_crm_set_task_status", {
        p_task_id: id,
        p_status: "completed",
      });
      if (doneError) return jsonError(doneError.message, 409, "TASK_COMPLETE_FAILED");
      return Response.json({ ok: true, executor: "akbs", action: "skipped", reason: "FEE_ALREADY_VERIFIED", task_status: "completed" });
    }

    const { error: startError } = await db.rpc("sav_ai_crm_set_task_status", {
      p_task_id: id,
      p_status: "in_progress",
    });
    if (startError) return jsonError(startError.message, 409, "TASK_START_FAILED");

    const applicationId = String(metadata.application_id || "");
    const feeAmount = Number(metadata.fee_amount || 0);
    const customerName = String(lead.title || task.related_name || "Customer");
    const subject = feeTask
      ? `AKBS Fee Payment Reminder${applicationId ? " - " + applicationId : ""}`
      : `AKBS Application Update${applicationId ? " - " + applicationId : ""}`;
    const text = feeTask
      ? [
          `Namaste ${customerName} ji,`,
          "",
          applicationId
            ? `Aapki AKBS application ${applicationId} ki registration/application fee abhi pending hai.`
            : "Aapki AKBS application ki registration/application fee abhi pending hai.",
          feeAmount > 0 ? `Pending fee: ₹${feeAmount.toLocaleString("en-IN")}` : "",
          "",
          "Kripya payment complete karke UTR / transaction reference aur payment proof Customer Portal me submit karein.",
          "Payment verify hone ke baad next Credit / Document / Finance processing automatically continue hogi.",
          "",
          "Customer Portal: https://crm.akbspoultry.com/customer-registration",
          "",
          "Regards,",
          "AKBS Poultry Farming Private Limited",
        ].filter(Boolean).join("\n")
      : [
          `Namaste ${customerName} ji,`,
          "",
          applicationId
            ? `Aapki AKBS application ${applicationId} hamare system me record hai.`
            : "Aapki AKBS application/enquiry hamare system me record hai.",
          "Aage ki process aur required updates ke liye AKBS team aapse sampark karegi.",
          "",
          "Regards,",
          "AKBS Poultry Farming Private Limited",
        ].join("\n");

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `sav-ai-task-${id}`,
      },
      body: JSON.stringify({
        from: "AKBS Poultry Farming Private Limited <updates@akbspoultry.com>",
        to: [recipient],
        subject,
        text,
      }),
    });

    const sent = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok || typeof sent.id !== "string" || !sent.id) {
      await db.rpc("sav_ai_crm_set_task_status", { p_task_id: id, p_status: "paused" });
      return Response.json(
        { error: sent.message || "EMAIL_TASK_FAILED", message: sent.message || "Email provider rejected the message.", executor: "akbs" },
        { status: response.status >= 400 ? response.status : 502 }
      );
    }

    const { error: completeError } = await db.rpc("sav_ai_crm_set_task_status", {
      p_task_id: id,
      p_status: "completed",
    });
    if (completeError) return jsonError(completeError.message, 409, "TASK_COMPLETE_FAILED");

    return Response.json({
      ok: true,
      executor: "akbs",
      action: feeTask ? "fee_reminder_sent" : "email_sent",
      provider_message_id: sent.id,
      task_status: "completed",
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
