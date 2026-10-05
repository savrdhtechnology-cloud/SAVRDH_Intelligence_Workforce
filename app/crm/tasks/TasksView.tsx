"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Archive,
  Bell,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Edit3,
  ListFilter,
  Loader2,
  Plus,
  Play,
  Pause,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  archiveTask,
  createTask,
  deleteTask,
  getTaskContext,
  getTaskDetail,
  listTasks,
  setTaskStatus,
  updateTask,
  runTaskWorkflow,
} from "./task-service";
import { executeAgent } from "../agents/agent-service";
import {
  EMPTY_TASK_DRAFT,
  TaskContext,
  TaskDetail,
  TaskDraft,
  TaskFilters,
  TaskPriority,
  TaskRecord,
  TaskScope,
  TaskStatus,
  validateTaskDraft,
} from "./task-types";

const scopes: Array<{ id: TaskScope; label: string }> = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "Completed" },
];

const priorities: TaskPriority[] = ["urgent", "high", "medium", "low"];
const statuses: TaskStatus[] = ["pending", "in_progress", "completed", "cancelled"];

type Props = {
  onChanged?: () => Promise<void> | void;
};

export default function TasksView({ onChanged }: Props) {
  const [context, setContext] = useState<TaskContext | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [filters, setFilters] = useState<TaskFilters>({ scope: "all", sort: "due_asc" });
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [draft, setDraft] = useState<TaskDraft>({ ...EMPTY_TASK_DRAFT });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  async function refresh(nextFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const [nextContext, nextTasks] = await Promise.all([
        context ? Promise.resolve(context) : getTaskContext(),
        listTasks(nextFilters),
      ]);
      setContext(nextContext);
      setTasks(nextTasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyFilters(next: TaskFilters) {
    setFilters(next);
    setSelectedTaskIds([]);
    await refresh(next);
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((current) =>
      current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId]
    );
  }

  function toggleSelectAllVisible() {
    const ids = tasks.filter((t) => t.status !== "completed").map((t) => t.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedTaskIds.includes(id));
    setSelectedTaskIds(allSelected ? [] : ids);
  }

  async function applyBulkStatus(status: TaskStatus) {
    if (!selectedTaskIds.length) return;
    setSaving(true);
    setError("");
    try {
      for (const taskId of selectedTaskIds) {
        await setTaskStatus(taskId, status);
      }
      setSelectedTaskIds([]);
      setRunMessage(
        status === "pending"
          ? "Selected tasks paused."
          : status === "cancelled"
            ? "Selected tasks cancelled."
            : "Selected tasks resumed."
      );
      await refresh();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk task action failed.");
    } finally {
      setSaving(false);
    }
  }

  function beginCreate() {
    const defaultMember = context?.member?.id || "";
    setEditingId(null);
    setDraft({ ...EMPTY_TASK_DRAFT, assignedTo: defaultMember });
    setFormErrors([]);
    setShowForm(true);
  }

  function beginEdit(task: TaskRecord) {
    setEditingId(task.id);
    setDraft({
      title: task.title,
      description: task.description || "",
      followupType: task.followup_type || task.task_type || "general",
      priority: task.priority,
      status: task.status,
      dueAt: toLocalInput(task.due_at),
      reminderAt: toLocalInput(task.reminder_at),
      leadId: task.lead_id || "",
      contactId: task.contact_id || "",
      notes: task.notes || "",
      assigneeType: task.assignee_type,
      assignedTo: task.assigned_to || "",
      assignedAgentId: task.assigned_agent_id || "",
    });
    setFormErrors([]);
    setShowForm(true);
  }

  async function submitTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const validation = validateTaskDraft(draft);
    setFormErrors(validation);
    if (validation.length) return;

    setSaving(true);
    setError("");
    try {
      if (editingId) await updateTask(editingId, draft);
      else await createTask(draft);
      setShowForm(false);
      setEditingId(null);
      await refresh();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Task could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(taskId: string) {
    setError("");
    try {
      setDetail(await getTaskDetail(taskId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load task details.");
    }
  }

  async function changeStatus(taskId: string, status: TaskStatus) {
    setSaving(true);
    setError("");
    try {
      await setTaskStatus(taskId, status);
      await refresh();
      if (detail?.task.id === taskId) setDetail(await getTaskDetail(taskId));
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update task.");
    } finally {
      setSaving(false);
    }
  }

  async function doArchive(taskId: string) {
    if (!window.confirm("Archive this task? It will be removed from active task views.")) return;
    setSaving(true);
    try {
      await archiveTask(taskId);
      setDetail(null);
      await refresh();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not archive task.");
    } finally {
      setSaving(false);
    }
  }

  async function doDelete(taskId: string) {
    if (!window.confirm("Permanently delete this task and its task activity history?")) return;
    setSaving(true);
    try {
      await deleteTask(taskId);
      setDetail(null);
      await refresh();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete task.");
    } finally {
      setSaving(false);
    }
  }

  async function runAiTask(task: TaskRecord) {
    if (task.assignee_type !== "ai" || !task.assigned_agent_id) {
      setError("This task is not assigned to an AI agent.");
      return;
    }
    if (!task.lead_id) {
      setError("Link this AI task to a CRM lead before running it.");
      return;
    }

    setRunningTaskId(task.id);
    setError("");
    setRunMessage("");
    try {
      const result = await runTaskWorkflow(task.id);
      const workflowStatus = result?.result?.status || "completed";
      const workType = result?.work_type || task.followup_type || task.task_type;
      setRunMessage(
        workflowStatus === "waiting_approval"
          ? `${workType} workflow started and is waiting for approval.`
          : workflowStatus === "waiting"
            ? `${workType} workflow started and is waiting for its next scheduled step.`
            : `${workType} workflow executed successfully.`
      );
      await refresh();
      if (detail?.task.id === task.id) setDetail(await getTaskDetail(task.id));
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Task workflow could not be started.");
      await refresh();
    } finally {
      setRunningTaskId(null);
    }
  }

  const metrics = useMemo(() => ({
    overdue: tasks.filter((t) => t.is_overdue).length,
    today: tasks.filter((t) => isToday(t.due_at) && t.status !== "completed").length,
    upcoming: tasks.filter((t) => isFuture(t.due_at) && !isToday(t.due_at) && t.status !== "completed").length,
    completed: tasks.filter((t) => t.status === "completed").length,
  }), [tasks]);

  return (
    <section className="task-module">
      <div className="task-metrics">
        <TaskMetric icon={CircleAlert} label="Overdue" value={metrics.overdue} />
        <TaskMetric icon={CalendarClock} label="Today" value={metrics.today} />
        <TaskMetric icon={Clock3} label="Upcoming" value={metrics.upcoming} />
        <TaskMetric icon={CheckCircle2} label="Completed" value={metrics.completed} />
      </div>

      <div className="task-toolbar">
        <div className="crm-search task-search">
          <Search size={15} />
          <input
            value={filters.search || ""}
            onChange={(e) => applyFilters({ ...filters, search: e.target.value })}
            placeholder="Search task, notes, lead or assignee..."
          />
        </div>
        <div className="task-toolbar-actions">
          <ListFilter size={14} />
          <select value={filters.priority || ""} onChange={(e) => applyFilters({ ...filters, priority: e.target.value as TaskPriority | "" })}>
            <option value="">All priorities</option>
            {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={filters.status || ""} onChange={(e) => applyFilters({ ...filters, status: e.target.value as TaskStatus | "" })}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          <select value={filters.assigneeType || ""} onChange={(e) => applyFilters({ ...filters, assigneeType: e.target.value as "human" | "ai" | "" })}>
            <option value="">All assignees</option>
            <option value="human">Human</option>
            <option value="ai">AI agent</option>
          </select>
          <select value={filters.sort || "due_asc"} onChange={(e) => applyFilters({ ...filters, sort: e.target.value as TaskFilters["sort"] })}>
            <option value="due_asc">Due soonest</option>
            <option value="due_desc">Due latest</option>
            <option value="priority">Priority</option>
            <option value="created_desc">Newest</option>
          </select>
          {context?.permissions.create && <button className="task-new-btn" onClick={beginCreate}><Plus size={14} /> New Task</button>}
        </div>
      </div>

      <div className="task-bulkbar">
        <label className="task-select-all">
          <input
            type="checkbox"
            checked={tasks.filter((t) => t.status !== "completed").length > 0 && tasks.filter((t) => t.status !== "completed").every((t) => selectedTaskIds.includes(t.id))}
            onChange={toggleSelectAllVisible}
          />
          <span>Select All</span>
        </label>
        <span>{selectedTaskIds.length} selected</span>
        <button onClick={() => applyBulkStatus("pending")} disabled={!selectedTaskIds.length || saving}>Pause Selected</button>
        <button onClick={() => applyBulkStatus("in_progress")} disabled={!selectedTaskIds.length || saving}>Resume Selected</button>
        <button className="danger" onClick={() => applyBulkStatus("cancelled")} disabled={!selectedTaskIds.length || saving}>Cancel Selected</button>
      </div>

      <div className="task-scopes">
        {scopes.map((scope) => (
          <button key={scope.id} className={filters.scope === scope.id ? "active" : ""} onClick={() => applyFilters({ ...filters, scope: scope.id })}>
            {scope.label}
          </button>
        ))}
      </div>

      {error && <div className="task-error">{error}</div>}
      {runMessage && <div className="agent-success">{runMessage}</div>}

      {loading ? (
        <div className="task-loading"><Loader2 className="spin" size={20} /> Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="crm-empty">
          <div><CheckCircle2 size={26} /><h3>No tasks in this view</h3><p>Create a task or change the current filters.</p></div>
        </div>
      ) : (
        <div className="task-list">
          {tasks.map((task) => (
            <motion.article key={task.id} className={`task-card ${task.is_overdue ? "overdue" : ""} ${selectedTaskIds.includes(task.id) ? "selected" : ""}`} whileHover={{ y: -2 }}>
              <div className="task-select-cell">
                <input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTaskSelection(task.id)} />
              </div>
              <button className="task-card-main" onClick={() => openDetail(task.id)}>
                <span className={`task-priority priority-${task.priority}`}>{task.priority}</span>
                <div className="task-card-copy">
                  <strong>{task.title}</strong>
                  <span>{task.related_name || "No linked lead/customer"} · {task.followup_type || task.task_type}</span>
                  <small><CalendarClock size={11} /> {formatDateTime(task.due_at)} {task.reminder_due ? <em><Bell size={10} /> reminder due</em> : null}</small>
                </div>
                <div className="task-assignee">
                  {task.assignee_type === "ai" ? <Bot size={13} /> : <UserRound size={13} />}
                  <span>{task.assigned_name || "Unassigned"}</span>
                </div>
                <ChevronRight size={16} />
              </button>
              <div className="task-card-actions">
                {task.status === "in_progress" && (
                  <button onClick={() => changeStatus(task.id, "pending")} disabled={saving} title="Pause task">
                    <Pause size={13} /><span>Pause</span>
                  </button>
                )}
                {task.status === "pending" && (
                  <button onClick={() => changeStatus(task.id, "in_progress")} disabled={saving} title="Resume task">
                    <Play size={13} /><span>Resume</span>
                  </button>
                )}
                {task.status !== "completed" && task.status !== "cancelled" && (
                  <button className="task-cancel-btn" onClick={() => changeStatus(task.id, "cancelled")} disabled={saving} title="Cancel task">
                    <X size={13} /><span>Cancel</span>
                  </button>
                )}
                {task.assignee_type === "ai" && task.status !== "completed" && task.status !== "cancelled" && (
                  <button
                    className="task-run-btn"
                    onClick={() => runAiTask(task)}
                    disabled={saving || runningTaskId === task.id}
                    title="Run AI task"
                  >
                    {runningTaskId === task.id ? <Loader2 className="spin" size={13} /> : <Play size={13} />}
                    <span>{task.status === "pending" ? "Run Task" : "Run Again"}</span>
                  </button>
                )}
                <select value={task.status} disabled={saving} onChange={(e) => changeStatus(task.id, e.target.value as TaskStatus)}>
                  {statuses.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
                <button onClick={() => beginEdit(task)} title="Edit task"><Edit3 size={13} /></button>
                <button onClick={() => doArchive(task.id)} title="Archive task"><Archive size={13} /></button>
              </div>
            </motion.article>
          ))}
        </div>
      )}

      {showForm && context && (
        <div className="crm-modal-wrap">
          <form className="crm-modal task-modal" onSubmit={submitTask}>
            <div className="crm-modal-head">
              <h3>{editingId ? "Edit Task" : "Create Task"}</h3>
              <button type="button" onClick={() => setShowForm(false)}><X size={15} /></button>
            </div>
            <div className="crm-form">
              <label className="full">Task title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required /></label>
              <label className="full">Description<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              <label>Follow-up type<select value={draft.followupType} onChange={(e) => setDraft({ ...draft, followupType: e.target.value })}>
                {context.followup_types.map((x) => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}
              </select></label>
              <label>Priority<select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}>
                {priorities.map((x) => <option key={x}>{x}</option>)}
              </select></label>
              <label>Status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}>
                {statuses.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}
              </select></label>
              <label>Related lead<select value={draft.leadId} onChange={(e) => setDraft({ ...draft, leadId: e.target.value, contactId: e.target.value ? "" : draft.contactId })}>
                <option value="">Not linked to lead</option>
                {context.leads.map((l) => <option key={l.id} value={l.id}>{l.title}{l.company ? ` — ${l.company}` : ""}</option>)}
              </select></label>
              <label>Related customer<select value={draft.contactId} onChange={(e) => setDraft({ ...draft, contactId: e.target.value, leadId: e.target.value ? "" : draft.leadId })}>
                <option value="">Not linked to customer</option>
                {context.contacts.map((x) => {
                  const name = [x.first_name, x.last_name].filter(Boolean).join(" ") || x.company || x.email || x.phone || "Customer";
                  return <option key={x.id} value={x.id}>{name}{x.company && name !== x.company ? ` — ${x.company}` : ""}</option>;
                })}
              </select></label>
              <label>Due date/time<input type="datetime-local" value={draft.dueAt} onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })} /></label>
              <label>Reminder<input type="datetime-local" value={draft.reminderAt} onChange={(e) => setDraft({ ...draft, reminderAt: e.target.value })} /></label>
              <label>Assignee type<select value={draft.assigneeType} onChange={(e) => setDraft({ ...draft, assigneeType: e.target.value as "human" | "ai" })}>
                <option value="human">Human user</option>
                {context.permissions.assign_ai && <option value="ai">AI agent</option>}
              </select></label>
              {draft.assigneeType === "human" ? (
                <label>Assign user<select value={draft.assignedTo} onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}>
                  <option value="">Select user</option>
                  {context.members.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email || "Workspace member"} — {m.role}</option>)}
                </select></label>
              ) : (
                <label>Assign AI agent<select value={draft.assignedAgentId} onChange={(e) => setDraft({ ...draft, assignedAgentId: e.target.value })}>
                  <option value="">Select agent</option>
                  {context.agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.role_name || a.status}</option>)}
                </select></label>
              )}
              <label className="full">Notes<textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
              {formErrors.length > 0 && <div className="task-validation full">{formErrors.map((x) => <div key={x}>{x}</div>)}</div>}
              <div className="crm-form-actions">
                <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="primary" disabled={saving}>{saving ? "Saving..." : editingId ? "Save Changes" : "Create Task"}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {detail && (
        <div className="task-drawer-wrap" onClick={() => setDetail(null)}>
          <aside className="task-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="task-drawer-head">
              <div><span>{detail.task.priority} priority</span><h3>{detail.task.title}</h3></div>
              <button onClick={() => setDetail(null)}><X size={16} /></button>
            </div>
            <div className="task-detail-grid">
              <Detail label="Status" value={detail.task.status.replace("_", " ")} />
              <Detail label="Due" value={formatDateTime(detail.task.due_at)} />
              <Detail label="Follow-up" value={detail.task.followup_type || detail.task.task_type} />
              <Detail label="Related" value={detail.task.related_name || "Not linked"} />
              <Detail label="Assignee" value={detail.task.assigned_name || "Unassigned"} />
              <Detail label="Reminder" value={formatDateTime(detail.task.reminder_at)} />
            </div>
            {detail.task.description && <div className="task-note"><b>Description</b><p>{detail.task.description}</p></div>}
            {detail.task.notes && <div className="task-note"><b>Notes</b><p>{detail.task.notes}</p></div>}

            <div className="task-history">
              <h4>Activity history</h4>
              {detail.activity.length ? detail.activity.map((a) => (
                <div className="task-history-row" key={a.id}>
                  <i />
                  <div><b>{a.title}</b><span>{a.description || a.activity_type}</span><small>{a.actor_name || "System"} · {formatDateTime(a.created_at)}</small></div>
                </div>
              )) : <p>No task activity yet.</p>}
            </div>

            <div className="task-drawer-actions">
              <button onClick={() => beginEdit(detail.task)}><Edit3 size={13} /> Edit</button>
              <button onClick={() => doArchive(detail.task.id)}><Archive size={13} /> Archive</button>
              {context?.permissions.delete && <button className="danger" onClick={() => doDelete(detail.task.id)}><Trash2 size={13} /> Delete permanently</button>}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

function TaskMetric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: number }) {
  return <div className="crm-card task-metric"><Icon size={15} /><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}

function toLocalInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function isToday(value?: string | null) {
  if (!value) return false;
  const a = new Date(value);
  const b = new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isFuture(value?: string | null) {
  return Boolean(value && new Date(value).getTime() > Date.now());
}
