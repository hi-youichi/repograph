# repograph

Export repository indexes as JSON graphs for other programs using the [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) CLI. No language model, API key, or MCP client is required.

## Installation

Requires Node.js 22 or later. Run directly with `npx`:

```bash
npx @youichi/repograph export /path/to/repository
```

The project pins `codebase-memory-mcp@0.12.1`. The initial installation downloads the native binary for your platform and requires access to npm and GitHub. Subsequent indexing runs locally. No global installation or editor/agent configuration through `codebase-memory-mcp install` is required.

## Exporting graphs

Run these commands from any directory:

```bash
# Export all nodes and relationships: functions, files, modules, calls, imports, inheritance, etc.
npx @youichi/repograph export ../anureo-sdk

# Specify an output file
npx @youichi/repograph export /path/to/repository --out .repograph/repository.json

# Keep only CALLS edges, functions, methods, and the endpoints of those edges
npx @youichi/repograph export ../anureo-sdk --kind calls --out .repograph/calls.json

# Show available options
npx @youichi/repograph --help
```

The default output is `.repograph/graph.json` under the current working directory. Progress goes to stderr. On success, stdout reports the output path and node and edge counts. Failures exit with code 1, and partial results never replace an existing output file.

| Option | Default | Purpose |
| --- | --- | --- |
| `--out`, `-o` | `.repograph/graph.json` | JSON output path |
| `--kind` | `all` | `all` exports all relationships; `calls` exports the call graph |
| `--project` | Directory name + hash of the absolute path | Override the upstream index name |
| `--page-size` | `500` | Rows per query batch, from 1 to 10000 |

Each export refreshes the index before reading nodes and edges separately. Queries support pagination and response cursors. Export stops if it detects evaluation limits, truncation without a continuation cursor, duplicate IDs, missing endpoints, or count mismatches. Call graphs retain functions and methods with no call edges.

## Output structure

The following is a simplified example. Actual properties depend on the language and upstream analysis results:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-12T00:00:00.000Z",
  "repositoryPath": "/path/to/repository",
  "project": "repository-0123456789ab",
  "kind": "calls",
  "indexReport": { "status": "indexed", "nodes": 2, "edges": 1 },
  "files": {
    "main.ts": { "lines": 7 }
  },
  "nodes": [
    {
      "id": "1",
      "labels": ["Function"],
      "name": "checkout",
      "qualifiedName": "repository.main.checkout",
      "filePath": "main.ts",
      "startLine": 1,
      "endLine": 3,
      "properties": {},
      "callable": { "parameters": [], "returnType": null }
    },
    {
      "id": "2",
      "labels": ["Function"],
      "name": "validate",
      "qualifiedName": "repository.main.validate",
      "filePath": "main.ts",
      "startLine": 5,
      "endLine": 7,
      "properties": {},
      "callable": { "parameters": [], "returnType": null }
    }
  ],
  "edges": [
    { "id": "1", "source": "1", "target": "2", "type": "CALLS", "properties": {} }
  ]
}
```

Node IDs and edge IDs are strings in separate namespaces. An edge's `source` and `target` refer to node IDs. IDs link records within the current export and are not guaranteed to remain stable across indexing runs. `indexReport` preserves the upstream indexing report; its counts still describe the original complete index in `calls` mode.

TypeScript and JavaScript `Function` and `Method` nodes include `callable` metadata in both `all` and `calls` exports. The exporter parses upstream `properties.signature` and `properties.return_type` with the TypeScript parser, without loading the target project's dependencies or inferring types. Supported file extensions are `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`. Other languages and node labels omit `callable`. The original `properties` remain intact, and this additive field retains `schemaVersion: 1`.

In `all` exports, TypeScript and JavaScript `Class` and `Interface` nodes include a `members` array for declared fields and accessors. Entries retain declared type text (or `null` when absent), source lines, visibility, static, optional, and readonly flags. The exporter also adds `DEPENDS_ON` edges for resolvable field, method-parameter, and method-return type references, plus method calls between classes. These source-derived edges have `properties.derivedFrom: "typescript-ast"` and a `reason`; they are omitted when a referenced class cannot be resolved without ambiguity. Other languages retain the class, field, inheritance, implementation, and dependency nodes and edges supplied by the upstream indexer.

For example, `function load(id: string, count = 1, ...tags: string[]): Promise<string[]>` produces:

```json
{
  "callable": {
    "parameters": [
      { "name": "id", "type": "string", "optional": false, "rest": false },
      { "name": "count", "type": null, "optional": true, "rest": false },
      { "name": "tags", "type": "string[]", "optional": false, "rest": true }
    ],
    "returnType": "Promise<string[]>"
  }
}
```

Parameter order follows the signature. `name` retains the source binding name or destructuring pattern. `type` is the declared type text, or `null` when no annotation is available. `optional` is true for a `?` marker or default initializer; `rest` identifies a `...` parameter. Default values do not cause type inference. Source-level TypeScript `this` parameters are retained when present in the upstream signature.

`parameters: []` means a known empty parameter list; `parameters: null` means the upstream signature is missing or could not be parsed. `returnType` excludes the leading colon and is `null` when no annotation is available; explicit `void`, `never`, and `Promise<T>` are preserved. If the combined signature and return annotation are malformed, both fields are `null`. Missing types are never replaced with `any` or `void`. Only the signature retained on each upstream node is exported; separate overloads, accessor pairs, generic parameter declarations, and omitted upstream symbols are not reconstructed.

`files` uses each `File` node's `filePath` as its key and records the physical line count in `lines`, including blank lines and comments. Empty files have `0` lines, and a trailing line ending does not add an extra line. LF, CRLF, and CR line endings are supported. Unreadable files have `null` lines. Counts come directly from source files at export time, rather than being inferred from upstream nodes' `properties.lines`. Both `all` and `calls` retain file information from the complete index, even when file nodes are filtered out of the call graph. Files outside the index are not scanned.

## TypeScript usage

The project also exports a thin wrapper that uses the CLI internally:

```typescript
import { exportGraph } from "./src/index.ts";

const graph = await exportGraph("../anureo-sdk", {
  kind: "calls",
  onProgress: console.error,
});

console.log(graph.nodes, graph.edges);

for (const node of graph.nodes) {
  if (node.callable) console.log(node.name, node.callable.parameters, node.callable.returnType);
}
```

## Development and validation

```bash
bun run typecheck
bun test
bun run test:integration
```

Unit tests cover pagination, cursors, truncation handling, file line counts, and structured callable metadata. The integration test uses the real native backend to index a temporary TypeScript project, checks cross-file calls, isolated functions, parameter and return annotations, methods, and export counts, and cleans up its temporary index.

## Limitations

- Exports contain the static relationships actually indexed upstream and do not guarantee coverage of all runtime calls. Support for reflection, dynamic dispatch, and framework conventions varies by language.
- The upstream indexer skips `node_modules`, files matching ignore rules, and other excluded inputs. Use the skip and parse counts in `indexReport` to assess coverage.
- `calls` mode retains only `CALLS` edges. It does not treat `CALL_REFERENCE` or `USAGE` as direct calls. The upstream analyzer may also record recursion in properties while omitting self-call edges.
- Keep source files and the project's index unchanged during export, and prevent other processes from rebuilding the index concurrently. Exports are not transactional snapshots across queries.
- Results are assembled in memory before being written to disk. Large repositories require sufficient memory, and upstream evaluation limits cause an error.
- Place output outside the target repository to prevent a later indexing run from treating exported files as input. Upstream indexes remain in the local cache.

The project currently exports JSON only. Graphviz, Cytoscape, or other frontend tools can consume it for visualization.
