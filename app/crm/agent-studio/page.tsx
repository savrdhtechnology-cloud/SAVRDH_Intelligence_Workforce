import WorkflowsRouteShell from "../workflows/WorkflowsRouteShell";

/**
 * AI Agent Studio: same organised workflow page (What happened · Customer
 * messages · Workflow builder). Kept as its own route for existing links.
 */
export default function AgentStudioPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0b1019", color: "#f1f5f9" }}>
      <WorkflowsRouteShell/>
    </main>
  );
}
