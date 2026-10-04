import { crmSupabase } from "../supabase-client";
import {
  TaskContext,
  TaskDetail,
  TaskDraft,
  TaskFilters,
  TaskRecord,
  toIsoOrNull,
} from "./task-types";

type RpcError = { message?: string } | null;

function throwRpc(error: RpcError, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function getTaskContext(): Promise<TaskContext> {
  const { data, error } = await crmSupabase.rpc("sav_ai_crm_task_context");
  if (error) throwRpc(error, "Could not load task configuration.");
  return data as TaskContext;
}

export async function listTasks(filters: TaskFilters): Promise<TaskRecord[]> {
  const { data, error } = await crmSupabase.rpc("sav_ai_crm_list_tasks", {
    p_scope: filters.scope || "all",
    p_status: filters.status || null,
    p_priority: filters.priority || null,
    p_search: filters.search?.trim() || null,
    p_assignee_type: filters.assigneeType || null,
    p_sort: filters.sort || "due_asc",
  });
  if (error) throwRpc(error, "Could not load tasks.");
  return (data || []) as TaskRecord[];
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail> {
  const { data, error } = await crmSupabase.rpc("sav_ai_crm_task_detail", {
    p_task_id: taskId,
  });
  if (error) throwRpc(error, "Could not load task details.");
  return data as TaskDetail;
}

function draftPayload(draft: TaskDraft) {
  return {
    p_title: draft.title.trim(),
    p_description: draft.description.trim() || null,
    p_followup_type: draft.followupType || "general",
    p_priority: draft.priority,
    p_status: draft.status,
    p_due_at: toIsoOrNull(draft.dueAt),
    p_reminder_at: toIsoOrNull(draft.reminderAt),
    p_lead_id: draft.leadId || null,
    p_contact_id: draft.contactId || null,
    p_notes: draft.notes.trim() || null,
    p_assignee_type: draft.assigneeType,
    p_assigned_to: draft.assigneeType === "human" ? draft.assignedTo || null : null,
    p_assigned_agent_id: draft.assigneeType === "ai" ? draft.assignedAgentId || null : null,
  };
}

export async function createTask(draft: TaskDraft): Promise<string> {
  const { data, error } = await crmSupabase.rpc("sav_ai_crm_create_task", draftPayload(draft));
  if (error) throwRpc(error, "Could not create task.");
  return String(data);
}

export async function updateTask(taskId: string, draft: TaskDraft): Promise<void> {
  const { error } = await crmSupabase.rpc("sav_ai_crm_update_task", {
    p_task_id: taskId,
    ...draftPayload(draft),
  });
  if (error) throwRpc(error, "Could not update task.");
}

export async function setTaskStatus(taskId: string, status: TaskRecord["status"]): Promise<void> {
  const { error } = await crmSupabase.rpc("sav_ai_crm_set_task_status", {
    p_task_id: taskId,
    p_status: status,
  });
  if (error) throwRpc(error, "Could not update task status.");
}

export async function archiveTask(taskId: string): Promise<void> {
  const { error } = await crmSupabase.rpc("sav_ai_crm_archive_task", {
    p_task_id: taskId,
  });
  if (error) throwRpc(error, "Could not archive task.");
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await crmSupabase.rpc("sav_ai_crm_delete_task", {
    p_task_id: taskId,
  });
  if (error) throwRpc(error, "Could not delete task.");
}

export type AgentTaskMutation = {
  taskId: string;
  action: "start" | "complete" | "cancel";
  note?: string;
};

/**
 * Controlled boundary for future SAVRDH Intelligence Workforce agents.
 * No autonomous behavior is implemented here. Agent runtimes must authenticate,
 * be linked to a workspace agent record and pass database permission checks.
 */
export async function mutateTaskAsAgent(input: AgentTaskMutation): Promise<void> {
  const { error } = await crmSupabase.rpc("sav_ai_crm_agent_task_action", {
    p_task_id: input.taskId,
    p_action: input.action,
    p_note: input.note?.trim() || null,
  });
  if (error) throwRpc(error, "Agent task action was rejected.");
}

export async function runTaskWorkflow(taskId: string): Promise<any> {
  const { data, error } = await crmSupabase.rpc("sav_ai_crm_run_task_workflow", {
    p_task_id: taskId,
  });
  if (error) throwRpc(error, "Workflow task execution failed.");
  if (data && data.ok === false) {
    throw new Error(data.message || data.error || "Workflow task execution was rejected.");
  }
  return data;
}
