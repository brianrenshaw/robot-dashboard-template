// Smoke test for the MCP Worker. Exercises the main tools end to end.
//   MCP_URL=https://project-dashboard-mcp.<sub>.workers.dev/mcp MCP_TOKEN=... npx tsx scripts/mcp-smoke.ts
// It writes one test entry (source_ref "smoke-test:<date>"), checks it, then undoes it with undo_last.

const URL_ = process.env.MCP_URL ?? "http://localhost:8788/mcp";
const TOKEN = process.env.MCP_TOKEN ?? "testtoken";
let id = 1;

async function call(method: string, params: unknown = {}) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKEN}`,
      "MCP-Protocol-Version": "2025-06-18",
      "X-Client-Name": "smoke-test",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
  });
  const text = await res.text();
  const json = text.includes("data:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text;
  const msg = JSON.parse(json);
  if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
  return msg.result;
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await call("tools/call", { name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { isError: !!r.isError, data };
}

function check(label: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) {
    console.log("      ", JSON.stringify(detail)?.slice(0, 400));
    process.exitCode = 1;
  }
}

async function main() {
  const tools = await call("tools/list");
  check("tools/list returns 24 tools", tools.tools.length === 24, tools.tools.length);

  const list = await tool("list_projects", { area: "work" });
  check("list_projects returns work projects", !list.isError && list.data.count > 0, list.data);

  const proj = await tool("get_project", { project: "pricing restructuring" });
  check("get_project resolves fuzzy title", !proj.isError && proj.data.title?.startsWith("PhD"), proj.data);

  const amb = await tool("search", { query: "Jon" });
  check("search finds Jon", !amb.isError && amb.data.people.length >= 1, amb.data);

  const tag = `smoke-test:${new Date().toISOString().slice(0, 10)}:${Math.random().toString(36).slice(2, 7)}`;
  const add = await tool("add_entry", {
    project: "Pricing Restructuring",
    people: ["Mark Hayes", "Aaron Wells"],
    kind: "meeting",
    title: "Smoke test meeting (safe to ignore)",
    source_ref: tag,
  });
  check("add_entry with two people", !add.isError && add.data.entry?.people?.length === 2, add.data);
  check("entry marked as written by MCP", add.data.entry?.written_by === "mcp:smoke-test", add.data.entry);

  const again = await tool("add_entry", { project: "Pricing Restructuring", kind: "meeting", title: "dupe", source_ref: tag });
  check("same source_ref returns the existing entry", again.data.duplicate === true, again.data);

  const mark = await tool("get_person", { person: "Mark Hayes" });
  const aaron = await tool("get_person", { person: "Aaron Wells" });
  check("entry shows on Mark's page", mark.data.recent_notes?.some((e: any) => e.title?.startsWith("Smoke test")), mark.data);
  check("entry shows on Aaron's page", aaron.data.recent_notes?.some((e: any) => e.title?.startsWith("Smoke test")), aaron.data);

  const wouldUndo = await tool("undo_last", { confirm: false });
  check("undo_last previews before acting", wouldUndo.data.confirm_needed === true, wouldUndo.data);
  const undo = await tool("undo_last", { confirm: true });
  check("undo_last reverses the test entry", undo.data.undone === true, undo.data);
  const after = await tool("get_person", { person: "Mark Hayes" });
  check("entry gone after undo", !after.data.recent_notes?.some((e: any) => e.title?.startsWith("Smoke test")), after.data);

  const brief = await tool("morning_brief_data");
  check("morning_brief_data returns today", !brief.isError && /^\d{4}-\d{2}-\d{2}$/.test(brief.data.today), brief.data);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
