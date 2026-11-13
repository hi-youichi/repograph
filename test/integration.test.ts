import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportGraph } from "../src/index.ts";
import { runTool } from "../src/cbm.ts";

test.skipIf(process.env.REPOGRAPH_INTEGRATION !== "1")(
  "exports a real multi-file graph with pagination and isolated functions",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "repograph-test-"));
    let project: string | undefined;
    try {
      await writeFile(join(root, "main.ts"), [
        'import { persist } from "./repository";',
        "export function checkout(id: string, options: { enabled: boolean } = { enabled: true }): boolean { validate(); persist(); return options.enabled; }",
        "function validate() { return true; }",
        "export function unused() { return 42; }",
      ].join("\n"));
      await writeFile(join(root, "repository.ts"), [
        "export function persist() { return true; }",
        "export class Repository { save(id: string, ...tags: string[]): void {} }",
      ].join("\n"));
      const graph = await exportGraph(root, { pageSize: 3 });
      project = graph.project;
      expect(graph.indexReport.nodes).toBe(graph.nodes.length);
      expect(graph.indexReport.edges).toBe(graph.edges.length);
      expect(graph.nodes.some((node) => node.name === "unused")).toBe(true);
      expect(graph.files["main.ts"]).toEqual({ lines: 4 });
      expect(graph.files["repository.ts"]).toEqual({ lines: 2 });
      expect(graph.nodes.find((node) => node.name === "checkout")?.callable).toEqual({
        parameters: [
          { name: "id", type: "string", optional: false, rest: false },
          { name: "options", type: "{ enabled: boolean }", optional: true, rest: false },
        ],
        returnType: "boolean",
      });
      expect(graph.nodes.find((node) => node.name === "unused")?.callable)
        .toEqual({ parameters: [], returnType: null });
      expect(graph.nodes.find((node) => node.name === "save")?.callable).toEqual({
        parameters: [
          { name: "id", type: "string", optional: false, rest: false },
          { name: "tags", type: "string[]", optional: false, rest: true },
        ],
        returnType: "void",
      });
      const byId = new Map(graph.nodes.map((node) => [node.id, node.name]));
      const calls = graph.edges.filter((edge) => edge.type === "CALLS")
        .map((edge) => `${byId.get(edge.source)} -> ${byId.get(edge.target)}`);
      expect(calls).toContain("checkout -> validate");
      expect(calls).toContain("checkout -> persist");
    } finally {
      if (project) await runTool("delete_project", { project });
      await rm(root, { recursive: true, force: true });
    }
  },
  120_000,
);
