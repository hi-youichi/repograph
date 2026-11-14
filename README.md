# repograph

[English](README.md) | [简体中文](README.zh-CN.md)

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
# Export all indexed nodes and relationships, plus source-derived class members and dependencies
npx @youichi/repograph export ../anureo-sdk

# Specify an output file
npx @youichi/repograph export /path/to/repository --out .repograph/repository.json

# Export only CALLS edges, functions/methods, and their endpoints
npx @youichi/repograph export ../anureo-sdk --kind calls --out .repograph/calls.json

# Show available options
npx @youichi/repograph --help
```

The default output is `.repograph/graph.json` under the current working directory. Progress goes to stderr. On success, stdout reports the output path and node and edge counts. Failures exit with code 1, and partial results never replace an existing output file.

| Option | Default | Purpose |
| --- | --- | --- |
| `--out`, `-o` | `.repograph/graph.json` | JSON output path |
| `--kind` | `all` | `all` includes class structure and dependencies; `calls` keeps only direct call relationships |
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

Node IDs and edge IDs are strings in separate namespaces. An edge's `source` and `target` refer to node IDs. IDs link records within the current export and are not guaranteed to remain stable across indexing runs. `indexReport` preserves the upstream indexing report; its counts describe the upstream index and can differ from the exported graph after filtering or adding source-derived class data.

TypeScript and JavaScript `Function` and `Method` nodes include `callable` metadata in both `all` and `calls` exports. The exporter parses upstream `properties.signature` and `properties.return_type` with the TypeScript parser, without loading the target project's dependencies or inferring types. Supported file extensions are `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`. Other languages and node labels omit `callable`. The original `properties` remain intact, and this additive field retains `schemaVersion: 1`.

In `all` exports, class-like nodes include a normalized `members` array whenever the upstream indexer emits `Field` or `Property` nodes. Each member also remains a graph node and receives a `HAS_PROPERTY` edge from its owning class. Entries include declared type text when available, source lines, visibility, static, optional, and readonly flags. The exporter derives `DEPENDS_ON` edges from upstream field and method type metadata when the target class resolves unambiguously. TypeScript and JavaScript receive an AST fallback for declared fields, accessors, and type references when upstream field nodes are absent. Derived edges identify their source in `properties.derivedFrom` (`upstream-index` or `typescript-ast`) and include a `reason`. `calls` exports intentionally omit class members and these dependencies. Available fields and relationships still depend on what the upstream indexer extracts for each language.

For example, `Customer` with an `address?: Address` field and a `save(input: Address): Result` method includes:

```json
{
  "labels": ["Class"],
  "name": "Customer",
  "members": [
    {
      "name": "address",
      "kind": "field",
      "type": "Address",
      "filePath": "model.ts",
      "startLine": 6,
      "endLine": 6,
      "visibility": "public",
      "static": false,
      "optional": true,
      "readonly": false
    }
  ]
}
```

The graph also contains a `HAS_PROPERTY` edge from `Customer` to its `address` field node and an edge such as `{ "source": "<Customer id>", "target": "<Address id>", "type": "DEPENDS_ON", "properties": { "derivedFrom": "upstream-index", "reason": "field-type", "member": "address" } }`. Existing upstream `INHERITS` and `IMPLEMENTS` edges are retained as-is.

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
bun run test:languages
npm run test:package
```

Unit tests cover pagination, cursors, truncation handling, file line counts, structured callable metadata, and completion of asynchronous class enrichment. Integration tests use the real native backend for the original multi-file TypeScript project and a corpus covering all 162 vendored grammars in the pinned backend. The language suite exercises the CLI's JSON output and the API's `calls` projection, definition preservation, file line counts, graph integrity, parse diagnostics, isolated functions, and class metadata. All 66 caller/callee samples require a resolved `CALLS` edge in both export modes. Temporary repositories and indexes are removed after each suite.

See [the language corpus](test/fixtures/languages/README.md) for coverage boundaries, fixture provenance, and the optional JSON coverage report. The presence of a vendored grammar does not guarantee that the upstream CLI can discover it as a standalone source file.

GitHub Actions validates Ubuntu, macOS, and Windows with Node.js 22 and 24. Every matrix job runs typechecking, unit tests, all language integration tests, and `npm run test:package`. The package check installs the built tarball into a temporary consumer project outside this checkout, invokes the installed CLI through npm, and verifies `all` and `calls` exports with TypeScript/Python calls and class metadata. Per-platform language reports are saved as workflow artifacts. Version-tag releases reuse this matrix and publish to npm only after all six jobs succeed.

## Publishing

Releases are published from GitHub Actions when a version tag is pushed. Before the first release, configure npm Trusted Publishing for package `@youichi/repograph` with GitHub user `hi-youichi`, repository `repograph`, and workflow file `publish-npm.yml`; allow direct `npm publish` for that publisher. Then update `package.json` to the new version and push the matching tag, for example `v0.1.1`. The workflow checks that the tag matches the package version, installs dependencies, runs typecheck and unit tests, then builds and publishes with npm provenance. No npm token is stored in GitHub Secrets.

## Limitations

- Exports contain the static relationships actually indexed upstream and do not guarantee coverage of all runtime calls. Support for reflection, dynamic dispatch, and framework conventions varies by language.
- The upstream indexer skips `node_modules`, files matching ignore rules, and other excluded inputs. Use the skip and parse counts in `indexReport` to assess coverage.
- `calls` mode retains only `CALLS` edges. It does not treat `CALL_REFERENCE` or `USAGE` as direct calls. The upstream analyzer may also record recursion in properties while omitting self-call edges.
- The exporter normalizes upstream class fields and type metadata without language-specific adapters. The pinned indexer does not emit every field or type relationship for every language, so missing upstream information cannot be reconstructed generically. Type references are not inferred from unannotated initializers.
- Keep source files and the project's index unchanged during export, and prevent other processes from rebuilding the index concurrently. Exports are not transactional snapshots across queries.
- Results are assembled in memory before being written to disk. Large repositories require sufficient memory, and upstream evaluation limits cause an error.
- Place output outside the target repository to prevent a later indexing run from treating exported files as input. Upstream indexes remain in the local cache.

The project currently exports JSON only. Graphviz, Cytoscape, or other frontend tools can consume it for visualization.
