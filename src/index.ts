import { readFile, realpath, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { collectRows, runTool, type QueryRow, type ToolRunner } from "./cbm.js";
import { addCallables } from "./callables.js";
import { addClassMetadata } from "./classes.js";

export interface GraphParameter {
  /** Source binding name or destructuring pattern. */
  name: string;
  /** Declared type text; null when no type annotation is available. */
  type: string | null;
  /** True for an optional marker or a default initializer. */
  optional: boolean;
  rest: boolean;
}

export interface GraphCallable {
  /** Empty means no parameters; null means the signature could not be parsed. */
  parameters: GraphParameter[] | null;
  /** Declared return type text, without the leading colon; never inferred. */
  returnType: string | null;
}

export interface GraphNode {
  id: string;
  labels: string[];
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  properties: Record<string, unknown>;
  /** Source-declared class fields and accessors, when available for the language. */
  members?: GraphClassMember[];
  /** Available for TypeScript/JavaScript Function and Method nodes. */
  callable?: GraphCallable;
}

export interface GraphClassMember {
  name: string;
  kind: "field" | "getter" | "setter";
  type: string | null;
  filePath: string;
  startLine: number;
  endLine: number;
  visibility: "public" | "protected" | "private";
  static: boolean;
  optional: boolean;
  readonly: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphFile {
  /** Physical lines, including comments and blank lines; null when unreadable. */
  lines: number | null;
}

export interface RepositoryGraph {
  schemaVersion: 1;
  generatedAt: string;
  repositoryPath: string;
  project: string;
  kind: "all" | "calls";
  indexReport: Record<string, unknown>;
  files: Record<string, GraphFile>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ExportOptions {
  project?: string;
  kind?: "all" | "calls";
  pageSize?: number;
  onProgress?: (message: string) => void;
}

const NODE_QUERY = `MATCH (n) RETURN id(n) AS id, labels(n) AS labels,
  n.name AS name, n.qualified_name AS qualifiedName, n.file_path AS filePath,
  n.start_line AS startLine, n.end_line AS endLine, properties(n) AS properties`;
const EDGE_QUERY = `MATCH (a)-[r]->(b) RETURN id(r) AS id,
  id(a) AS source, id(b) AS target, type(r) AS type, properties(r) AS properties`;

function field(row: QueryRow, key: string): string {
  const value = row[key];
  if (value === undefined) throw new Error(`Missing graph field: ${key}`);
  return value;
}

function properties(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid graph properties");
  }
  return value as Record<string, unknown>;
}

function line(value: string): number | null {
  if (value === "" || value === "null" || value === "0") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid line: ${value}`);
  return number;
}

async function fileLines(path: string): Promise<number | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\r") {
      lines++;
      if (text[i + 1] === "\n") i++;
    } else if (text[i] === "\n") {
      lines++;
    }
  }
  return lines + (text.endsWith("\n") || text.endsWith("\r") ? 0 : 1);
}

/** Always refresh the index before exporting; no model or MCP connection needed. */
export async function exportGraph(
  repository: string,
  options: ExportOptions = {},
  run: ToolRunner = runTool,
): Promise<RepositoryGraph> {
  const repositoryPath = await realpath(repository);
  if (!(await stat(repositoryPath)).isDirectory()) throw new Error("Repository must be a directory");
  const pageSize = options.pageSize ?? 500;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 10_000) {
    throw new Error("pageSize must be an integer between 1 and 10000");
  }
  const kind = options.kind ?? "all";
  if (kind !== "all" && kind !== "calls") throw new Error("kind must be all or calls");
  const suffix = createHash("sha256").update(repositoryPath).digest("hex").slice(0, 12);
  const name = options.project ?? `${basename(repositoryPath)}-${suffix}`;
  options.onProgress?.(`Indexing ${repositoryPath}`);
  const indexReport = await run("index_repository", { repo_path: repositoryPath, name });
  if (indexReport.status !== "indexed" || typeof indexReport.project !== "string") {
    throw new Error(`Indexing did not complete: ${JSON.stringify(indexReport)}`);
  }
  const project = indexReport.project;
  options.onProgress?.("Exporting nodes");
  const nodeRows = await collectRows(run, project, NODE_QUERY, pageSize);
  const nodes: GraphNode[] = nodeRows.map((row) => {
    const labels: unknown = JSON.parse(field(row, "labels"));
    if (!Array.isArray(labels) || !labels.every((label) => typeof label === "string")) {
      throw new Error("Invalid node labels");
    }
    return {
      id: field(row, "id"), labels, name: field(row, "name"),
      qualifiedName: field(row, "qualifiedName"), filePath: field(row, "filePath"),
      startLine: line(field(row, "startLine")), endLine: line(field(row, "endLine")),
      properties: properties(field(row, "properties")),
    };
  });
  options.onProgress?.("Exporting edges");
  const edgeRows = await collectRows(run, project, EDGE_QUERY, pageSize);
  const edges: GraphEdge[] = edgeRows.map((row) => ({
    id: field(row, "id"), source: field(row, "source"), target: field(row, "target"),
    type: field(row, "type"), properties: properties(field(row, "properties")),
  }));
  if (nodes.length !== indexReport.nodes || edges.length !== indexReport.edges) {
    throw new Error("Export counts differ from the index; the index may have changed or queries were limited");
  }
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length || new Set(edges.map((edge) => edge.id)).size !== edges.length ||
      edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) {
    throw new Error("Graph contains duplicate IDs or missing edge endpoints");
  }
  options.onProgress?.("Counting file lines");
  const filePaths = new Set(nodes.filter((node) => node.labels.includes("File"))
    .map((node) => node.filePath)
    .filter((path) => path !== "" && path !== "{}" && path !== "null"));
  const files: Record<string, GraphFile> = Object.create(null);
  for (const path of filePaths) {
    files[path] = { lines: await fileLines(resolve(repositoryPath, path)) };
  }
  const selectedEdges = kind === "calls" ? edges.filter((edge) => edge.type === "CALLS") : edges;
  const endpoints = new Set(selectedEdges.flatMap((edge) => [edge.source, edge.target]));
  const selectedNodes = kind === "calls"
    ? nodes.filter((node) => endpoints.has(node.id) || node.labels.some((label) => label === "Function" || label === "Method"))
    : nodes;
  options.onProgress?.("Extracting callable signatures");
  addCallables(selectedNodes);
  if (kind === "all") {
    options.onProgress?.("Extracting class members and type dependencies");
    await addClassMetadata(repositoryPath, nodes, edges);
  }
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), repositoryPath,
    project, kind, indexReport, files, nodes: selectedNodes, edges: selectedEdges,
  };
}
