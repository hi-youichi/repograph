# repograph

[English](README.md) | [简体中文](README.zh-CN.md)

使用 [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) CLI 将代码仓库索引导出为 JSON 图数据，供其他程序使用。无需语言模型、API 密钥或 MCP 客户端。

## 安装

需要 Node.js 22 或更高版本。通过 `npx` 直接运行：

```bash
npx @youichi/repograph export /path/to/repository
```

本项目固定使用 `codebase-memory-mcp@0.12.1`。首次安装会下载适用于当前平台的原生二进制文件，需要访问 npm 和 GitHub。后续索引操作均在本地运行。无需全局安装，也无需通过 `codebase-memory-mcp install` 配置编辑器或智能体。

## 导出图数据

可在任意目录运行以下命令：

```bash
# 导出索引中的全部节点和关系，以及从源码提取的类成员和依赖
npx @youichi/repograph export ../anureo-sdk

# 指定输出文件
npx @youichi/repograph export /path/to/repository --out .repograph/repository.json

# 仅导出 CALLS 边、函数和方法，以及这些边的端点
npx @youichi/repograph export ../anureo-sdk --kind calls --out .repograph/calls.json

# 查看可用选项
npx @youichi/repograph --help
```

默认输出路径为当前工作目录下的 `.repograph/graph.json`。进度信息写入 stderr；成功后，stdout 会显示输出路径以及节点和边的数量。失败时以退出码 1 结束，部分结果不会覆盖已有的输出文件。

| 选项 | 默认值 | 用途 |
| --- | --- | --- |
| `--out`, `-o` | `.repograph/graph.json` | JSON 输出路径 |
| `--kind` | `all` | `all` 包含类结构和依赖；`calls` 仅保留直接调用关系 |
| `--project` | 目录名 + 绝对路径的哈希值 | 自定义上游索引名称 |
| `--page-size` | `500` | 每批查询的行数，范围为 1 至 10000 |

每次导出都会先刷新索引，再分别读取节点和边。查询支持分页和响应游标。如果检测到求值限制、截断后缺少后续游标、重复 ID、缺失端点或数量不匹配，导出会停止。调用图会保留没有调用边的函数和方法。

## 输出结构

以下为简化示例。实际属性取决于编程语言和上游分析结果：

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

节点 ID 和边 ID 均为字符串，分属独立的命名空间。边的 `source` 和 `target` 指向节点 ID。这些 ID 用于关联当前导出中的记录，不保证在多次索引之间保持稳定。`indexReport` 保留上游索引报告；其中的数量描述的是上游索引，在过滤或添加从源码提取的类数据后，可能与导出的图数据不同。

在 `all` 和 `calls` 两种导出模式中，TypeScript 和 JavaScript 的 `Function`、`Method` 节点均包含 `callable` 元数据。导出器使用 TypeScript 解析器解析上游的 `properties.signature` 和 `properties.return_type`，不会加载目标项目的依赖或推断类型。支持的文件扩展名为 `.ts`、`.tsx`、`.mts`、`.cts`、`.js`、`.jsx`、`.mjs` 和 `.cjs`。其他语言和节点标签不包含 `callable`。原始 `properties` 保持不变，新增此字段后仍使用 `schemaVersion: 1`。

在 `all` 模式下，只要上游索引器生成了 `Field` 或 `Property` 节点，类及类似结构的节点就会包含规范化的 `members` 数组。每个成员同时保留为图节点，并通过一条从所属类指向该成员的 `HAS_PROPERTY` 边关联。成员条目包含可用的声明类型文本、源码行号、可见性，以及静态、可选和只读标记。当目标类可被唯一确定时，导出器会根据上游字段和方法的类型元数据派生 `DEPENDS_ON` 边。如果缺少上游字段节点，TypeScript 和 JavaScript 会通过 AST 补充解析声明的字段、访问器和类型引用。派生边通过 `properties.derivedFrom` 标明来源（`upstream-index` 或 `typescript-ast`），并包含 `reason`。`calls` 模式不包含类成员及这些依赖。可用字段和关系仍取决于上游索引器对各语言的提取能力。

例如，若 `Customer` 包含 `address?: Address` 字段和 `save(input: Address): Result` 方法，导出结果会包含：

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

图中还会包含一条从 `Customer` 指向其 `address` 字段节点的 `HAS_PROPERTY` 边，以及类似 `{ "source": "<Customer id>", "target": "<Address id>", "type": "DEPENDS_ON", "properties": { "derivedFrom": "upstream-index", "reason": "field-type", "member": "address" } }` 的边。上游已有的 `INHERITS` 和 `IMPLEMENTS` 边会原样保留。

例如，`function load(id: string, count = 1, ...tags: string[]): Promise<string[]>` 会生成：

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

参数顺序与签名一致。`name` 保留源码中的绑定名称或解构模式。`type` 为声明的类型文本，没有类型注解时为 `null`。带有 `?` 标记或默认初始值的参数，其 `optional` 为 true；`rest` 用于标识 `...` 参数。默认值不会触发类型推断。如果上游签名包含 TypeScript 源码中的 `this` 参数，该参数也会保留。

`parameters: []` 表示已知参数列表为空；`parameters: null` 表示上游签名缺失或无法解析。`returnType` 不包含开头的冒号，没有类型注解时为 `null`；显式声明的 `void`、`never` 和 `Promise<T>` 会保留。如果签名与返回类型注解组合后格式无效，两个字段均为 `null`。缺失的类型不会被替换为 `any` 或 `void`。导出器仅导出每个上游节点保留的签名，不会重建独立的重载、成对的访问器、泛型参数声明或上游遗漏的符号。

`files` 以各个 `File` 节点的 `filePath` 为键，通过 `lines` 记录文件的实际行数，包括空行和注释。空文件为 `0` 行，文件末尾的换行符不会额外增加一行。支持 LF、CRLF 和 CR 换行符。无法读取的文件，其行数为 `null`。行数在导出时直接从源码文件读取，不根据上游节点的 `properties.lines` 推断。`all` 和 `calls` 模式都会保留完整索引中的文件信息，即使调用图已过滤掉文件节点。不会扫描索引之外的文件。

## 在 TypeScript 中使用

本项目也导出了一个轻量封装，内部调用 CLI：

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

## 开发与验证

```bash
bun run typecheck
bun test
bun run test:integration
bun run test:languages
```

单元测试覆盖分页、游标、截断处理、文件行数、结构化的可调用对象元数据，以及异步类成员提取完成后才返回的行为。集成测试使用真实原生后端，覆盖原有多文件 TypeScript 项目和固定依赖中的全部 162 种语法样例，校验 CLI JSON 输出、API 的 `calls` 图、定义保留、文件行数、图完整性、解析诊断、孤立函数和类元数据。66 组调用样例均要求在两种导出模式中生成 `CALLS` 边。测试结束后清理临时仓库和索引。

覆盖边界、样例来源和可选 JSON 报告见[全语言测试说明](test/fixtures/languages/README.md)。内置语法不一定能通过上游 CLI 作为独立源码文件被识别。

## 发布

推送版本标签后，GitHub Actions 会发布新版本。首次发布前，请为 npm 包 `@youichi/repograph` 配置 Trusted Publishing，使用 GitHub 用户 `hi-youichi`、仓库 `repograph` 和工作流文件 `publish-npm.yml`，并允许该发布方直接执行 `npm publish`。随后将 `package.json` 更新为新版本，再推送对应标签，例如 `v0.1.1`。工作流会检查标签是否与包版本匹配、安装依赖、运行类型检查和单元测试，然后构建并发布，同时附带 npm provenance 来源证明。GitHub Secrets 中不存储 npm 令牌。

## 限制

- 导出结果包含上游实际索引到的静态关系，不保证覆盖所有运行时调用。对反射、动态分派和框架约定的支持因语言而异。
- 上游索引器会跳过 `node_modules`、匹配忽略规则的文件及其他被排除的输入。可通过 `indexReport` 中的跳过和解析数量评估覆盖范围。
- `calls` 模式仅保留 `CALLS` 边，不会将 `CALL_REFERENCE` 或 `USAGE` 视为直接调用。上游分析器也可能在属性中记录递归信息，而不生成自调用边。
- 导出器无需针对各语言编写适配器，即可规范化上游类字段和类型元数据。固定版本的索引器并不会为每种语言生成全部字段或类型关系，因此无法用通用方式重建上游缺失的信息。不会根据没有类型注解的初始值推断类型引用。
- 导出期间请保持源码文件和项目索引不变，并防止其他进程同时重建索引。导出结果不是跨查询的事务性快照。
- 结果会先在内存中组装，再写入磁盘。大型仓库需要足够内存；触及上游求值限制时会报错。
- 请将输出放在目标仓库之外，以免后续索引将导出文件视为输入。上游索引会保留在本地缓存中。

本项目目前仅导出 JSON，可使用 Graphviz、Cytoscape 或其他前端工具进行可视化。
