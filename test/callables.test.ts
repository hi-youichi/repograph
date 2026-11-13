import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportGraph, type GraphNode } from "../src/index.ts";
import { addCallables } from "../src/callables.ts";
import type { ToolRunner } from "../src/cbm.ts";

function node(properties: Record<string, unknown>, filePath = "main.ts", label = "Function"): GraphNode {
  return {
    id: "1", labels: [label], name: "example", qualifiedName: "demo.example",
    filePath, startLine: 1, endLine: 1, properties,
  };
}

test("extracts nested types, destructuring, defaults, optional and rest parameters without inference", () => {
  const example = node({
    signature: `({ id, flags: [first] }: { id: string; flags: boolean[] },
      convert: (x: Map<string, number>) => [string, number],
      count = Math.max(1, 2), options?: { active: boolean }, ...tags: string[])`,
    return_type: ": Promise<Array<[string, number]>>",
  });
  addCallables([example]);
  expect(example.callable).toEqual({
    parameters: [
      { name: "{ id, flags: [first] }", type: "{ id: string; flags: boolean[] }", optional: false, rest: false },
      { name: "convert", type: "(x: Map<string, number>) => [string, number]", optional: false, rest: false },
      { name: "count", type: null, optional: true, rest: false },
      { name: "options", type: "{ active: boolean }", optional: true, rest: false },
      { name: "tags", type: "string[]", optional: false, rest: true },
    ],
    returnType: "Promise<Array<[string, number]>>",
  });
});

test("preserves generic references, receiver parameters, parameter properties and declared special returns", () => {
  const examples = [
    node({ signature: "<T extends { id: string }>(this: Service, value: T)", return_type: ": T" }),
    node({ signature: "(readonly id: string)", return_type: ": void" }, "main.ts", "Method"),
    node({ signature: "()", return_type: ": value is string" }),
    node({ signature: "()", return_type: ": asserts value is string" }),
    node({ signature: "()", return_type: ": never" }),
  ];
  addCallables(examples);
  expect(examples[0]!.callable).toEqual({
    parameters: [
      { name: "this", type: "Service", optional: false, rest: false },
      { name: "value", type: "T", optional: false, rest: false },
    ],
    returnType: "T",
  });
  expect(examples[1]!.callable).toEqual({
    parameters: [{ name: "id", type: "string", optional: false, rest: false }],
    returnType: "void",
  });
  expect(examples.slice(2).map((example) => example.callable?.returnType))
    .toEqual(["value is string", "asserts value is string", "never"]);
});

test("distinguishes no parameters from unavailable or malformed signatures", () => {
  const examples = [
    node({ signature: "()" }),
    node({}),
    node({ signature: "", return_type: ": number" }),
    node({ signature: "(value: )" }),
    node({ signature: "(value: string", return_type: ": number" }),
    node({ signature: "()", return_type: ": Promise<" }),
    node({ signature: "()", return_type: ":" }),
    node({ signature: "() {} function other()" }),
  ];
  addCallables(examples);
  expect(examples.map((example) => example.callable)).toEqual([
    { parameters: [], returnType: null },
    { parameters: null, returnType: null },
    { parameters: null, returnType: "number" },
    ...Array.from({ length: 5 }, () => ({ parameters: null, returnType: null })),
  ]);
});

test("supports JavaScript and TypeScript extensions and leaves other languages and labels untouched", () => {
  const extensions = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "TS"];
  const examples = extensions.map((extension) => node({ signature: "(value)" }, `file.${extension}`));
  const unsupported = [
    node({ signature: "(value: str)", return_type: "str" }, "file.py"),
    node({ signature: "(value: string)" }, "file.ts", "Class"),
  ];
  addCallables([...examples, ...unsupported]);
  for (const example of examples) {
    expect(example.callable).toEqual({
      parameters: [{ name: "value", type: null, optional: false, rest: false }],
      returnType: null,
    });
  }
  for (const example of unsupported) expect(example).not.toHaveProperty("callable");
});

test("parses JSX defaults using the file's syntax mode", () => {
  const examples = [
    node({ signature: "(content = <Widget size={1} />)" }, "view.tsx"),
    node({ signature: "(content = <span>hello</span>)" }, "view.jsx"),
    node({ signature: "(content = <string>value)" }, "main.ts"),
  ];
  addCallables(examples);
  for (const example of examples) {
    expect(example.callable).toEqual({
      parameters: [{ name: "content", type: null, optional: true, rest: false }],
      returnType: null,
    });
  }
});

test("exports callable metadata in all and calls modes without changing raw properties or graph counts", async () => {
  const root = await mkdtemp(join(tmpdir(), "repograph-callables-"));
  const properties = { signature: "(id: string)", return_type: ": boolean", custom: 42 };
  const rows = [
    ["1", '["Function"]', "example", "demo.example", "main.ts", "1", "1", JSON.stringify(properties)],
    ["2", '["Method"]', "save", "demo.Service.save", "main.ts", "2", "2", '{"signature":"()"}'],
    ["3", '["Class"]', "Service", "demo.Service", "main.ts", "2", "2", "{}"],
  ];
  const run: ToolRunner = async (tool, args) => {
    if (tool === "index_repository") return { status: "indexed", project: "demo", nodes: 3, edges: 1 };
    return {
      columns: String(args.query).startsWith("MATCH (n)")
        ? ["id", "labels", "name", "qualifiedName", "filePath", "startLine", "endLine", "properties"]
        : ["id", "source", "target", "type", "properties"],
      rows: String(args.query).startsWith("MATCH (n)") ? rows : [["1", "1", "2", "CALLS", "{}"]],
      total_relation: "eq", has_more: false, truncated: false,
    };
  };
  try {
    const all = await exportGraph(root, {}, run);
    const calls = await exportGraph(root, { kind: "calls" }, run);
    expect(all.nodes).toHaveLength(3);
    expect(calls.nodes).toHaveLength(2);
    expect(all.edges).toEqual(calls.edges);
    expect(all.nodes[0]!.properties).toEqual(properties);
    expect(all.nodes[0]!.callable).toEqual({
      parameters: [{ name: "id", type: "string", optional: false, rest: false }],
      returnType: "boolean",
    });
    expect(calls.nodes).toEqual(all.nodes.slice(0, 2));
    expect(all.nodes[2]).not.toHaveProperty("callable");
    expect(all.schemaVersion).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
