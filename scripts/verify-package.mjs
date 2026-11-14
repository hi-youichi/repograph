import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const exec = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
assert(npmCli, "Run this check with npm run test:package");

async function npm(args, cwd) {
  try {
    // Run npm's JS entry with the selected Node version, including on Windows.
    return await exec(process.execPath, [npmCli, ...args], {
      cwd, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`npm ${args[0]} failed\n${error.stdout ?? ""}\n${error.stderr ?? ""}`, { cause: error });
  }
}

// Spaces exercise argument handling in both npm's executable shim and the exporter.
const work = await mkdtemp(join(tmpdir(), "repograph package smoke-"));
const consumer = join(work, "consumer project");
const source = join(work, "source repository");
const project = `repograph-package-${process.pid}-${Date.now()}`;
let cleanupIndex;
let indexingStarted = false;
try {
  await mkdir(consumer);
  await mkdir(source);
  console.log("Packing the built CLI");
  const { stdout } = await npm(["pack", "--ignore-scripts", "--json", "--pack-destination", work], repositoryRoot);
  const [packed] = JSON.parse(stdout);
  assert(packed.files.some((file) => file.path === "dist/cli.js"));
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "repograph-smoke-consumer", private: true }));
  console.log("Installing the tarball in an isolated consumer project");
  await npm([
    "install", "--no-package-lock", "--no-audit", "--no-fund", "--foreground-scripts",
    join(work, packed.filename),
  ], consumer);

  const installedRoot = join(consumer, "node_modules", "@youichi", "repograph");
  const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  assert.equal(manifest.version, packed.version);
  assert.equal(manifest.bin.repograph, "dist/cli.js");
  const cli = await readFile(join(installedRoot, manifest.bin.repograph), "utf8");
  assert(cli.startsWith("#!/usr/bin/env node"));
  cleanupIndex = (await import(pathToFileURL(join(installedRoot, "dist", "cbm.js")).href)).runTool;

  const help = await npm(["exec", "--offline", "--", "repograph", "--help"], consumer);
  assert(help.stdout.includes("Usage: repograph export"));
  await writeFile(join(source, "models.ts"), [
    "export class Address {}",
    "export class Customer { readonly address?: Address; }",
    "export function helper(value: number): number { return value + 1; }",
    "export function run(): number { return helper(41); }",
    "export function isolated(): void {}",
    "",
  ].join("\n"));
  await writeFile(join(source, "example.py"), [
    "def helper(value):",
    "    return value + 1",
    "",
    "def run():",
    "    return helper(41)",
    "",
  ].join("\n"));

  for (const kind of ["all", "calls"]) {
    console.log(`Verifying installed CLI: ${kind}`);
    const output = join(work, `${kind}.json`);
    indexingStarted = true;
    const result = await npm([
      "exec", "--offline", "--", "repograph", "export", source,
      "--project", project, "--kind", kind, "--page-size", "3", "--out", output,
    ], consumer);
    const graph = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(JSON.parse(result.stdout), { output, nodes: graph.nodes.length, edges: graph.edges.length, kind });
    assert.equal(graph.kind, kind);
    assert.equal(graph.files["models.ts"].lines, 5);
    assert.equal(graph.files["example.py"].lines, 5);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const file of ["models.ts", "example.py"]) {
      assert(graph.edges.some((edge) => edge.type === "CALLS" &&
        byId.get(edge.source)?.filePath === file && byId.get(edge.source)?.name === "run" &&
        byId.get(edge.target)?.filePath === file && byId.get(edge.target)?.name === "helper"), `${kind}: ${file} call`);
    }
    assert(graph.nodes.some((node) => node.name === "isolated"));
    if (kind === "all") {
      const customer = graph.nodes.find((node) => node.name === "Customer");
      assert(customer?.members?.some((member) => member.name === "address" && member.type === "Address"));
      assert(graph.edges.some((edge) => edge.type === "DEPENDS_ON" && edge.source === customer.id));
    } else {
      assert(graph.edges.every((edge) => edge.type === "CALLS"));
      assert(graph.nodes.every((node) => node.members === undefined));
    }
  }
  console.log(`Installed package verified: ${process.platform}/${process.arch}, Node ${process.versions.node}, all/calls CLI exports passed.`);
} finally {
  try {
    if (cleanupIndex && indexingStarted) await cleanupIndex("delete_project", { project });
  } finally {
    await rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
