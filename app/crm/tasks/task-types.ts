export type TaskStatus = "pending" | "paused" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskScope = "all" | "today" | "overdue" | "upcoming" | "completed";
export type TaskAssigneeType = "human" | "ai";
export type TaskSort = "due_asc" | "due_desc" | "priority" | "created_desc";

export type TaskAssignee = {
  id: string;
  type: TaskAssigneeType;
  name: string;
  role?: string | null;
};

export type TaskContext = {
  member: {
    id: string;
    role: string;
    full_name: string | null;
    email: string | null;
  };
  members: Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    role: string;
  }>;
  agents: Array<{
    id: string;
    name: string;
    role_name: string | null;
    status: string;
  }>;
  leads: Array<{
    id: string;
    title: string;
    company: string | null;
    status: string;
  }>;
  contacts: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    email: string | null;
    phone: string | null;
  }>;
  followup_types: string[];
  permissions: {
    create: boolean;
    edit_all: boolean;
    assign_ai: boolean;
    delete: boolean;
  };
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  task_type: string;
  followup_type: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  reminder_at: string | null;
  reminder_sent_at: string | null;
  lead_id: string | null;
  contact_id: string | null;
  assigned_to: string | null;
  assigned_agent_id: string | null;
  assignee_type: TaskAssigneeType;
  assigned_name: string | null;
  assigned_role: string | null;
  related_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  is_overdue: boolean;
  reminder_due: boolean;
};

export type TaskActivity = {
  id: string;
  activity_type: string;
  title: string;
  description: string | null;
  created_at: string;
  actor_name: string | null;
  metadata?: Record<string, unknown>;
};

export type TaskDetail = {
  task: TaskRecord;
  activity: TaskActivity[];
};

export type TaskFilters = {
  scope: TaskScope;
  status?: TaskStatus | "";
  priority?: TaskPriority | "";
  search?: string;
  assigneeType?: TaskAssigneeType | "";
  sort?: TaskSort;
};

export type TaskDraft = {
  title: string;
  description: string;
  followupType: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string;
  reminderAt: string;
  leadId: string;
  contactId: string;
  notes: string;
  assigneeType: TaskAssigneeType;
  assignedTo: string;
  assignedAgentId: string;
};

export const EMPTY_TASK_DRAFT: TaskDraft = {
  title: "",
  description: "",
  followupType: "general",
  priority: "medium",
  status: "pending",
  dueAt: "",
  reminderAt: "",
  leadId: "",
  contactId: "",
  notes: "",
  assigneeType: "human",
  assignedTo: "",
  assignedAgentId: "",
};

export function validateTaskDraft(draft: TaskDraft): string[] {
  const errors: string[] = [];
  const title = draft.title.trim();

  if (title.length < 3) errors.push("Task title must be at least 3 characters.");
  if (title.length > 180) errors.push("Task title must be 180 characters or fewer.");

  const due = draft.dueAt ? new Date(draft.dueAt) : null;
  const reminder = draft.reminderAt ? new Date(draft.reminderAt) : null;

  if (due && Number.isNaN(due.getTime())) errors.push("Due date/time is invalid.");
  if (reminder && Number.isNaN(reminder.getTime())) errors.push("Reminder date/time is invalid.");
  if (due && reminder && reminder.getTime() > due.getTime()) {
    errors.push("Reminder must be scheduled on or before the due time.");
  }

  if (draft.assigneeType === "human" && !draft.assignedTo) {
    errors.push("Select a human assignee.");
  }
  if (draft.assigneeType === "ai" && !draft.assignedAgentId) {
    errors.push("Select an AI agent.");
  }

  return errors;
}

export function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function taskPriorityWeight(priority: TaskPriority): number {
  return ({ urgent: 4, high: 3, medium: 2, low: 1 })[priority];
}
