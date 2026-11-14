import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportGraph } from "../src/index.ts";
import type { ToolRunner } from "../src/cbm.ts";

test("awaits class source enrichment before returning the exported graph", async () => {
  const root = await mkdtemp(join(tmpdir(), "repograph-classes-"));
  const run: ToolRunner = async (tool, args) => {
    if (tool === "index_repository") return { status: "indexed", project: "demo", nodes: 2, edges: 0 };
    const nodes = String(args.query).startsWith("MATCH (n)");
    return {
      columns: nodes
        ? ["id", "labels", "name", "qualifiedName", "filePath", "startLine", "endLine", "properties"]
        : ["id", "source", "target", "type", "properties"],
      rows: nodes ? [
        ["1", '["Class"]', "Address", "demo.Address", "models.ts", "1", "1", "{}"],
        ["2", '["Class"]', "Customer", "demo.Customer", "models.ts", "2", "4", "{}"],
      ] : [],
      total_relation: "eq", has_more: false, truncated: false,
    };
  };
  try {
    await writeFile(join(root, "models.ts"), [
      "export class Address {}",
      "export class Customer {",
      "  readonly address?: Address;",
      "}",
    ].join("\n"));
    const graph = await exportGraph(root, {}, run);
    // Inspect immediately: an extra await here would mask the missing-await regression.
    expect(graph.nodes.find((node) => node.name === "Customer")?.members).toEqual([{
      name: "address", kind: "field", type: "Address", filePath: "models.ts",
      startLine: 3, endLine: 3, visibility: "public", static: false, optional: true, readonly: true,
    }]);
    expect(graph.edges).toContainEqual(expect.objectContaining({
      source: "2", target: "1", type: "DEPENDS_ON",
      properties: { derivedFrom: "typescript-ast", reason: "field-type", member: "address" },
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
