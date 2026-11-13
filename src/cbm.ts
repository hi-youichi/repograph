import { createRequire } from "node:module";
import { spawn } from "node:child_process";

export type ToolArgs = Record<string, unknown>;
export type ToolRunner = (tool: string, args: ToolArgs) => Promise<Record<string, unknown>>;

/** Run the package-local native backend through its CLI, without a shell. */
export const runTool: ToolRunner = async (tool, args) => {
  const shim = createRequire(import.meta.url).resolve("codebase-memory-mcp/bin.js");
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [shim, "cli", "--json", tool], { stdio: ["pipe", "pipe", "inherit"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`codebase-memory-mcp ${tool} exited with ${code}`)));
    child.stdin.end(JSON.stringify(args));
  });

  const envelope = JSON.parse(stdout) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text?: string }[];
  };
  const message = envelope.content?.filter((part) => part.type === "text")
    .map((part) => part.text ?? "").join("\n") ?? "";
  if (envelope.isError) throw new Error(message || `${tool} failed`);
  const payload: unknown = envelope.structuredContent ?? JSON.parse(message);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${tool} returned an invalid payload`);
  }
  return payload as Record<string, unknown>;
};

export type QueryRow = Record<string, string>;

/** Page the query itself, then drain any additional CLI response pages. */
export async function collectRows(
  run: ToolRunner,
  project: string,
  baseQuery: string,
  pageSize: number,
): Promise<QueryRow[]> {
  const result: QueryRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const query = `${baseQuery} ORDER BY id SKIP ${offset} LIMIT ${pageSize}`;
    let cursor: string | undefined;
    let count = 0;
    const seenCursors = new Set<string>();
    do {
      const page = await run("query_graph", {
        project, query, format: "json", max_rows: pageSize,
        max_output_tokens: 1_000_000,
        ...(cursor ? { cursor } : {}),
      });
      if (page.total_relation !== "eq" || page.warning) {
        throw new Error(`Query evaluation is incomplete: ${page.warning ?? page.truncation_reason ?? "inexact total"}`);
      }
      if (!Array.isArray(page.columns) || !page.columns.every((x) => typeof x === "string") ||
          !Array.isArray(page.rows)) {
        throw new Error("Unexpected query_graph response shape");
      }
      const columns = page.columns as string[];
      for (const row of page.rows) {
        if (!Array.isArray(row) || row.length !== columns.length ||
            !row.every((value) => typeof value === "string")) {
          throw new Error("Unexpected query_graph row shape");
        }
        result.push(Object.fromEntries(columns.map((name, i) => [name, row[i] as string])));
        count++;
      }
      if (page.has_more === false && page.truncated === false) break;
      if (typeof page.next_cursor !== "string" || seenCursors.has(page.next_cursor)) {
        throw new Error("Query result was truncated without an advancing cursor; export aborted");
      }
      cursor = page.next_cursor;
      seenCursors.add(cursor);
    } while (true);
    if (count < pageSize) return result;
  }
}
