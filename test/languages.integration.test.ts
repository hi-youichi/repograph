import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportGraph, type GraphNode, type RepositoryGraph } from "../src/index.ts";
import { runTool } from "../src/cbm.ts";
import { fixtureRoot, languageFixtures } from "./language-fixtures.ts";

const callableLabels = new Set(["Function", "Method"]);
const structuralLabels = new Set(["File", "Module", "Folder", "Package", "Directory"]);
const nodeKey = (node: GraphNode) => JSON.stringify([
  node.filePath, node.qualifiedName, node.startLine, [...node.labels].sort(),
]);

describe.skipIf(process.env.REPOGRAPH_INTEGRATION !== "1")("real backend: all 162 supported grammars", () => {
  let root: string;
  let repository: string;
  let project: string;
  let all: RepositoryGraph;
  let calls: RepositoryGraph;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "repograph-languages-"));
    repository = join(root, "repository");
    // A known name also lets afterAll remove the index when export itself fails.
    project = `repograph-languages-${root.split("-").at(-1)}`;
    await Promise.all(languageFixtures.map((fixture) => cp(
      join(fixtureRoot, fixture.language), join(repository, fixture.language), { recursive: true },
    )));
    const output = join(root, "all.json");
    const cli = Bun.spawn([
      process.execPath, fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
      "export", repository, "--project", project, "--page-size", "500", "--out", output,
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(cli.stdout).text(), new Response(cli.stderr).text(), cli.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    all = JSON.parse(await readFile(output, "utf8"));
    expect(JSON.parse(stdout)).toEqual({ output, nodes: all.nodes.length, edges: all.edges.length, kind: "all" });
    calls = await exportGraph(repository, { project, kind: "calls", pageSize: 500 });
    if (process.env.REPOGRAPH_LANGUAGE_REPORT) {
      const report = languageFixtures.map((fixture) => {
        const definitions = all.nodes.filter((node) => node.filePath === fixture.file &&
          !node.labels.some((label) => structuralLabels.has(label)));
        const sample = fixture.call;
        const caller = sample && all.nodes.find((node) => node.filePath === sample.file && node.name === sample.caller);
        const callee = sample && all.nodes.find((node) => node.filePath === sample.file && node.name === sample.callee);
        return {
          language: fixture.language, file: fixture.file,
          indexed: Object.hasOwn(all.files, fixture.file),
          definitions: definitions.map((node) => ({ name: node.name, labels: node.labels })),
          ...(fixture.excluded ? { exclusion: fixture.excluded } : {}),
          ...(fixture.limitation ? { limitation: fixture.limitation } : {}),
          ...(sample ? { call: {
            file: sample.file, caller: sample.caller, callee: sample.callee,
            resolved: all.edges.some((edge) => edge.type === "CALLS" &&
              edge.source === caller?.id && edge.target === callee?.id),
          } } : {}),
        };
      });
      const path = resolve(process.env.REPOGRAPH_LANGUAGE_REPORT);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify({
        backendVersion: "0.12.1", generatedAt: new Date().toISOString(),
        nodes: all.nodes.length, edges: all.edges.length, indexReport: all.indexReport, languages: report,
      }, null, 2)}\n`);
    }
  }, 120_000);

  afterAll(async () => {
    try {
      if (project) await runTool("delete_project", { project });
    } finally {
      if (root) await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  for (const fixture of languageFixtures) {
    test(`${fixture.language}: ${fixture.excluded ? "documents source exclusion" : "exports file, definitions and call filtering"}`, async () => {
      const nodes = all.nodes.filter((node) => node.filePath === fixture.file);
      if (fixture.excluded) {
        expect(nodes).toEqual([]);
        expect(all.files).not.toHaveProperty(fixture.file);
        expect(calls.files).not.toHaveProperty(fixture.file);
        return;
      }
      const file = nodes.find((node) => node.labels.includes("File"));
      expect(file, fixture.file).toBeDefined();
      const source = await readFile(join(repository, fixture.file), "utf8");
      const lines = source.split(/\r\n|\r|\n/).length - (/[\r\n]$/.test(source) ? 1 : 0);
      expect(all.files[fixture.file]).toEqual({ lines });
      expect(calls.files[fixture.file]).toEqual({ lines });
      const definitions = nodes.filter((node) => !node.labels.some((label) => structuralLabels.has(label)));
      expect(definitions.length, fixture.language).toBeGreaterThanOrEqual(fixture.minDefinitions);
      for (const name of fixture.definitions) expect(definitions.map((node) => node.name)).toContain(name);
      const exportedCallables = calls.nodes.filter((node) => node.filePath === fixture.file).map(nodeKey);
      for (const node of nodes.filter((node) => node.labels.some((label) => callableLabels.has(label)))) {
        expect(exportedCallables).toContain(nodeKey(node));
      }
      if (!["javascript", "typescript", "tsx"].includes(fixture.language)) {
        for (const node of nodes) expect(node).not.toHaveProperty("callable");
      }
    });

    if (fixture.call) {
      const call = fixture.call;
      test(`${fixture.language}: resolves the caller/callee CALLS edge`, () => {
        for (const graph of [all, calls]) {
          const nodes = graph.nodes.filter((node) => node.filePath === call.file);
          const caller = nodes.find((node) => node.name === call.caller && node.labels.some((label) => callableLabels.has(label)));
          const callee = nodes.find((node) => node.name === call.callee && node.labels.some((label) => callableLabels.has(label)));
          expect(caller, `${call.file}: caller`).toBeDefined();
          expect(callee, `${call.file}: callee`).toBeDefined();
          expect(graph.edges.some((edge) => edge.type === "CALLS" &&
            edge.source === caller!.id && edge.target === callee!.id), call.file).toBe(true);
        }
      });
    }
  }

  test("indexes the corpus without partial or unusable parses", () => {
    for (const graph of [all, calls]) {
      expect(graph.indexReport.parse_partial_count, JSON.stringify(graph.indexReport.parse_partial)).toBe(0);
      expect(graph.indexReport.parse_unusable_count, JSON.stringify(graph.indexReport.parse_unusable)).toBe(0);
      expect(graph.indexReport.not_indexed_files_count).toBe(0);
      expect(graph.indexReport.skipped_count).toBe(0);
    }
  });

  test("keeps unique IDs, valid endpoints, upstream counts and the exact calls projection", () => {
    for (const graph of [all, calls]) {
      const ids = new Set(graph.nodes.map((node) => node.id));
      expect(ids.size).toBe(graph.nodes.length);
      expect(new Set(graph.edges.map((edge) => edge.id)).size).toBe(graph.edges.length);
      for (const edge of graph.edges) {
        expect(ids.has(edge.source)).toBe(true);
        expect(ids.has(edge.target)).toBe(true);
      }
    }
    expect(all.nodes.length).toBeGreaterThanOrEqual(Number(all.indexReport.nodes));
    expect(all.edges.length).toBeGreaterThanOrEqual(Number(all.indexReport.edges));
    expect(calls.files).toEqual(all.files);
    expect(calls.edges.every((edge) => edge.type === "CALLS")).toBe(true);
    const edgeKeys = (graph: RepositoryGraph) => {
      const byId = new Map(graph.nodes.map((node) => [node.id, node]));
      return graph.edges.filter((edge) => edge.type === "CALLS").map((edge) =>
        JSON.stringify([nodeKey(byId.get(edge.source)!), nodeKey(byId.get(edge.target)!)]),
      ).sort();
    };
    // IDs may change on reindexing; compare source identities instead.
    expect(edgeKeys(calls)).toEqual(edgeKeys(all));
  });

  test("retains isolated functions and JS/TS declared callable annotations", () => {
    for (const graph of [all, calls]) {
      for (const language of ["javascript", "typescript", "python"]) {
        const isolated = graph.nodes.find((node) => node.filePath.startsWith(`${language}/`) && node.name === "isolated");
        expect(isolated).toBeDefined();
        expect(graph.edges.some((edge) => edge.type === "CALLS" &&
          (edge.source === isolated!.id || edge.target === isolated!.id))).toBe(false);
      }
      expect(graph.nodes.find((node) => node.filePath === "typescript/calls.ts" && node.name === "helper")?.callable).toEqual({
        parameters: [{ name: "value", type: "number", optional: false, rest: false }], returnType: "number",
      });
      expect(graph.nodes.find((node) => node.filePath === "javascript/calls.js" && node.name === "helper")?.callable).toEqual({
        parameters: [{ name: "value", type: null, optional: false, rest: false }], returnType: null,
      });
    }
  });

  test("finishes source-derived class members and dependencies before resolving exportGraph", () => {
    const customer = all.nodes.find((node) => node.filePath === "typescript/models.ts" && node.name === "Customer");
    const address = all.nodes.find((node) => node.filePath === "typescript/models.ts" && node.name === "Address");
    expect(customer?.members).toContainEqual({
      name: "address", kind: "field", type: "Address", filePath: "typescript/models.ts",
      startLine: 3, endLine: 3, visibility: "public", static: false, optional: true, readonly: true,
    });
    expect(all.edges.some((edge) => edge.type === "DEPENDS_ON" &&
      edge.source === customer!.id && edge.target === address!.id)).toBe(true);
    expect(calls.nodes.every((node) => node.members === undefined)).toBe(true);
    expect(calls.edges.some((edge) => edge.type === "HAS_PROPERTY" || edge.type === "DEPENDS_ON")).toBe(false);
  });
});
