import { extname } from "node:path";
import ts from "typescript";
import type { GraphCallable, GraphNode } from "./index.js";

const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

/** Parse upstream signatures as syntax only, without resolving or inferring types. */
export function addCallables(nodes: GraphNode[]): void {
  const inputs = nodes.filter((node) =>
    node.labels.some((label) => label === "Function" || label === "Method") &&
    EXTENSIONS.has(extname(node.filePath).toLowerCase()));
  if (inputs.length === 0) return;

  const sources = new Map<string, ts.SourceFile>();
  const signatures = inputs.map((node, i) => {
    const rawSignature = node.properties.signature;
    const signature = typeof rawSignature === "string" && rawSignature.trim() !== ""
      ? rawSignature.trim() : null;
    const rawReturn = node.properties.return_type;
    const returnType = typeof rawReturn === "string" && rawReturn.trim() !== ""
      ? rawReturn.trim().replace(/^:\s*/, "") : null;
    const jsx = [".tsx", ".jsx"].includes(extname(node.filePath).toLowerCase());
    const path = `/__repograph_signatures__/${i}.${jsx ? "tsx" : "ts"}`;
    const text = `function __repograph${signature ?? "()"}${returnType !== null ? `: ${returnType}` : ""}\n{}`;
    sources.set(path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
      jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
    return { node, path, signature };
  });

  // A virtual program exposes the compiler's public syntax diagnostics API.
  // No repository files, imports, tsconfig, or standard libraries are loaded.
  const options: ts.CompilerOptions = {
    noLib: true, noResolve: true, noEmit: true,
    target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (path) => sources.get(path),
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (path) => sources.has(path),
    readFile: (path) => sources.get(path)?.text,
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  for (const { node, path, signature } of signatures) {
    const callable: GraphCallable = { parameters: null, returnType: null };
    node.callable = callable;
    const source = sources.get(path)!;
    const declaration = source.statements[0];
    if (program.getSyntacticDiagnostics(source).length !== 0 ||
        source.statements.length !== 1 || !declaration ||
        !ts.isFunctionDeclaration(declaration) || declaration.name?.text !== "__repograph" ||
        !declaration.body || declaration.body.statements.length !== 0) continue;

    if (signature !== null) {
      callable.parameters = declaration.parameters.map((parameter) => ({
        name: parameter.name.getText(source),
        type: parameter.type?.getText(source) ?? null,
        optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
        rest: parameter.dotDotDotToken !== undefined,
      }));
    }
    callable.returnType = declaration.type?.getText(source) ?? null;
  }
}
