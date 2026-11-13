#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { exportGraph } from "./index.js";

const HELP = `repograph — export repository graphs with codebase-memory-mcp

Usage: repograph export <repository> [options]

Options:
  -o, --out <file>       JSON output (default: .repograph/graph.json)
      --kind <all|calls> Export all relationships or CALLS only (default: all)
      --project <name>   Override the path-derived index name
      --page-size <n>    Query batch size, 1–10000 (default: 500)
  -h, --help            Show help
`;

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), allowPositionals: true, strict: true,
    options: {
      out: { type: "string", short: "o" },
      kind: { type: "string" }, project: { type: "string" },
      "page-size": { type: "string" }, help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return;
  }
  if (positionals[0] !== "export" || positionals.length !== 2) {
    throw new Error("Expected: export <repository>. Use --help for usage.");
  }
  const kind = values.kind ?? "all";
  if (kind !== "all" && kind !== "calls") throw new Error("--kind must be all or calls");
  if (values.project !== undefined && !values.project.trim()) throw new Error("--project cannot be empty");
  const graph = await exportGraph(positionals[1]!, {
    kind, project: values.project,
    pageSize: values["page-size"] === undefined ? undefined : Number(values["page-size"]),
    onProgress: (message) => console.error(message),
  });
  const output = resolve(values.out ?? ".repograph/graph.json");
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(JSON.stringify({ output, nodes: graph.nodes.length, edges: graph.edges.length, kind }));
}

main().catch((error: unknown) => {
  console.error(`repograph: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
