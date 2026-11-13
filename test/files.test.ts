import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportGraph } from "../src/index.ts";
import type { ToolRunner } from "../src/cbm.ts";

test("exports physical file lines in all and calls graphs, including unknown and empty files", async () => {
  const root = await mkdtemp(join(tmpdir(), "repograph-lines-"));
  const contents: Record<string, string> = {
    "empty.ts": "",
    "main.ts": "// comment\n\nexport function main() {}\n",
    "unterminated.ts": "first\nsecond",
    "windows.ts": "first\r\n\r\nlast\r\n",
    "cr.ts": "first\rsecond\r",
    "blank.ts": "\n",
    "single.ts": "one",
    ["__proto__"]: "one\n",
  };
  const paths = [...Object.keys(contents), "missing.ts"];
  const columns = ["id", "labels", "name", "qualifiedName", "filePath", "startLine", "endLine", "properties"];
  const rows = paths.map((path, i) => [
    String(i), '["File"]', path, path, path, "null", "null", "{}",
  ]);
  // A function shares its file with a File node. Its span is not the file's size.
  rows.push(["function", '["Function"]', "main", "main", "main.ts", "3", "3", '{"lines":1}']);
  rows.push(["project", '["Project"]', "demo", "demo", "{}", "null", "null", "{}"]);
  rows.push(["folder", '["Folder"]', ".", "demo.folder", ".", "null", "null", "{}"]);
  const run: ToolRunner = async (tool, args) => {
    if (tool === "index_repository") {
      return { status: "indexed", project: "demo", nodes: rows.length, edges: 0 };
    }
    const nodes = String(args.query).startsWith("MATCH (n)");
    return {
      columns: nodes ? columns : ["id", "source", "target", "type", "properties"],
      rows: nodes ? rows : [], total_relation: "eq", has_more: false, truncated: false,
    };
  };
  try {
    for (const [path, content] of Object.entries(contents)) {
      await writeFile(join(root, path), content);
    }
    const all = await exportGraph(root, {}, run);
    const calls = await exportGraph(root, { kind: "calls" }, run);
    const expected = JSON.parse(`{
      "empty.ts": { "lines": 0 },
      "main.ts": { "lines": 3 },
      "unterminated.ts": { "lines": 2 },
      "windows.ts": { "lines": 3 },
      "cr.ts": { "lines": 2 },
      "blank.ts": { "lines": 1 },
      "single.ts": { "lines": 1 },
      "__proto__": { "lines": 1 },
      "missing.ts": { "lines": null }
    }`);
    expect(JSON.parse(JSON.stringify(all.files))).toEqual(expected);
    expect(calls.files).toEqual(all.files);
    expect(calls.nodes.map((node) => node.id)).toEqual(["function"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
