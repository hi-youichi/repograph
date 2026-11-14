# 全语言测试样例

覆盖当前固定依赖 `codebase-memory-mcp@0.12.1` 的全部 **162 个 vendored grammar**。每个目录对应一种语法，`manifest.json` 指定源码路径、定义数量下限、预期符号名、调用样例及已知限制。`test/language-fixtures.ts` 保留独立的完整语言清单，普通单元测试会检查清单、样例和已安装依赖版本是否一致。

在项目根目录运行：

```bash
# 单元测试、样例完整性检查
bun test

# 仅运行全语言真实后端测试
bun run test:languages

# 同时运行原有 TypeScript 集成测试和全语言集成测试
bun run test:integration

# 将实际索引及调用解析情况写入 JSON
REPOGRAPH_LANGUAGE_REPORT=.repograph/language-coverage.json bun run test:languages
```

集成测试将源码复制到临时仓库，通过当前项目的 `src/cli.ts export` 生成 `all` JSON，再通过 `exportGraph()` 生成 `calls` 图。输出放在待索引仓库之外。测试校验文件物理行数、定义下限和指定符号、零部分解析及不可用解析告警、孤立函数保留、JS/TS 可调用元数据、类成员及类型依赖、ID 唯一性、边端点完整性，以及跨索引的调用关系一致性。查询使用 500 行分页；测试结束后清理仓库和临时索引。

覆盖范围和限制：

| 项目 | 校验内容 |
| --- | --- |
| 162 种语法样例 | 160 种样例校验文件导出、行数及其可用定义；2 种明确校验独立文件不被导出 |
| `gitignore` | `.gitignore` 作为忽略规则被消费，不作为源码导出 |
| `jsdoc` | `.jsdoc` 无独立文件识别入口；另在 JavaScript 调用样例中包含 JSDoc 注释，不据此声称独立 JSDoc 语法已被调用 |
| `systemverilog` | 固定版本将 `.sv` 路由到 Verilog；文件被导出不等同于验证了独立 SystemVerilog 解析器 |
| 66 组调用样例 | 全部校验调用双方符号在 `all`、`calls` 中保留，并严格要求同文件 `caller → callee` 的 `CALLS` 边；不存在跳过调用边断言的语言 |

`minDefinitions: 0` 表示该样例只要求可导出文件和保持图完整，不代表该语言能够提取函数、类或调用关系。测试不需要安装各语言的编译器，也不运行样例本身；校验对象是 repograph 的静态索引和导出行为。报告中的 `call.resolved` 记录实际观测值。JSON 报告是观测结果，是否通过以测试进程退出码为准。

基础语法样例和部分调用样例改编自上游固定版本的 [grammar regression fixtures](https://github.com/DeusData/codebase-memory-mcp/blob/v0.12.1/tests/test_grammar_regression.c) 和 [language contracts](https://github.com/DeusData/codebase-memory-mcp/blob/v0.12.1/tests/test_lang_contract.c)，保留其预期符号与定义下限。完整语言清单来自 [vendored grammar manifest](https://github.com/DeusData/codebase-memory-mcp/blob/v0.12.1/internal/cbm/vendored/grammars/MANIFEST.md)。上游 MIT 许可见 [LICENSE.upstream](LICENSE.upstream)。本项目补充 ObjectScript UDL / routine、主流语言调用样例、TypeScript 类成员样例，并修正 NASM、SSH Config、Hyprlang 的文件名以符合真实发现规则。
