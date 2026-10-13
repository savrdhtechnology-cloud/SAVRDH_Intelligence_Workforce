import Link from "next/link";
import { Bot, Boxes, Activity, ShieldCheck, FlaskConical, Network, Bug, Users } from "lucide-react";
import WorkflowsRouteShell from "../workflows/WorkflowsRouteShell";

const shortcuts = [
  { href: "/crm/workforce", label: "Workforce Control", icon: Users, detail: "Plan agent assignments by product" },
  { href: "/crm/agent-studio/debug", label: "Debug Console", icon: Bug, detail: "Inspect runs and redacted node logs" },
  { href: "/crm/agents", label: "Agent Library", icon: Bot, detail: "Choose and configure an agent" },
  { href: "/crm/workflows/executions", label: "Execution Logs", icon: Activity, detail: "Inspect workflow runs and failures" },
  { href: "/crm/workflows", label: "Workflow Registry", icon: Boxes, detail: "Create, version and activate flows" },
] as const;

/**
 * First-stage n8n-style studio entry point.
 * The canvas, graph persistence, tests and execution are the established
 * authenticated workflow engine, not a parallel client-only simulator.
 */
export default function AgentStudioPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0b1019", color: "#f1f5f9" }}>
      <section style={{ maxWidth: 1560, margin: "0 auto", padding: "26px 22px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span aria-hidden="true" style={{ border: "1px solid #1b736a", background: "#123a38", borderRadius: 12, padding: 10 }}><Network size={22} color="#66e6d5"/></span>
          <div>
            <div style={{ color: "#62dacb", letterSpacing: 2, fontSize: 11, fontWeight: 700 }}>SAVRDH AI OS</div>
            <h1 style={{ fontSize: "clamp(24px,3vw,34px)", margin: "3px 0" }}>AI Agent Studio</h1>
            <p style={{ color: "#93a3b8", fontSize: 13, margin: 0 }}>Design → Connect → Test → Review → Activate</p>
          </div>
          <Link href="/crm" style={{ marginLeft: "auto", color: "#b8c7d8", textDecoration: "none", border: "1px solid #334155", padding: "9px 14px", borderRadius: 9 }}>Back to AI OS</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12, marginTop: 22 }}>
          {shortcuts.map(({ href, label, icon: Icon, detail }) => (
            <Link key={href} href={href} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, textDecoration: "none", color: "#eef3fa", border: "1px solid #2d3747", background: "#151e2b", borderRadius: 12 }}>
              <Icon size={21} color="#71dfd0"/>
              <span><strong style={{ display: "block", fontSize: 13 }}>{label}</strong><small style={{ color: "#95a7b9" }}>{detail}</small></span>
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", color: "#b3c3d2", margin: "16px 0 4px", fontSize: 12 }}>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}><FlaskConical size={14} color="#f7bc68"/> Test in preview before executing</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}><ShieldCheck size={14} color="#70d6bb"/> External actions remain permission-gated</span>
        </div>
      </section>
      <WorkflowsRouteShell/>
    </main>
  );
}
