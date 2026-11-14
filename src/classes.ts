import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import ts from "typescript";
import type { GraphClassMember, GraphEdge, GraphNode } from "./index.js";

const CLASS_LABELS = new Set(["Class", "Interface", "Struct", "Trait"]);
const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS, ".tsx": ts.ScriptKind.TSX, ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS, ".js": ts.ScriptKind.JS, ".jsx": ts.ScriptKind.JSX,
  ".mjs": ts.ScriptKind.JS, ".cjs": ts.ScriptKind.JS,
};

function modifiers(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function memberName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) &&
      (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))) return name.expression.text;
  return undefined;
}

function typeNames(type: ts.TypeNode, into = new Set<string>()): Set<string> {
  const visit = (node: ts.Node) => {
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText().split(".").at(-1);
      if (name) into.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(type);
  return into;
}

function referencedNames(typeText: string): Set<string> {
  return new Set(typeText.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? []);
}

function propertyText(node: GraphNode, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = node.properties[key];
    if (typeof value === "string" && value.trim()) return value.replace(/^\s*:\s*/, "").trim();
  }
  return undefined;
}

function propertyTypes(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function sourceLine(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}

function sourceEndLine(file: ts.SourceFile, node: ts.Node): number {
  return file.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function toMember(file: ts.SourceFile, filePath: string, node: ts.Node): GraphClassMember | undefined {
  if (!ts.isPropertyDeclaration(node) && !ts.isPropertySignature(node) &&
      !ts.isGetAccessorDeclaration(node) && !ts.isSetAccessorDeclaration(node)) return undefined;
  const name = memberName(node.name);
  if (name === undefined) return undefined;
  const flags = modifiers(node);
  const visibility = flags.some((flag) => flag.kind === ts.SyntaxKind.PrivateKeyword) || name.startsWith("#")
    ? "private" : flags.some((flag) => flag.kind === ts.SyntaxKind.ProtectedKeyword) ? "protected" : "public";
  const kind = ts.isGetAccessorDeclaration(node) ? "getter" : ts.isSetAccessorDeclaration(node) ? "setter" : "field";
  return {
    name, kind, type: node.type?.getText(file) ?? null, filePath,
    startLine: sourceLine(file, node), endLine: sourceEndLine(file, node), visibility,
    static: flags.some((flag) => flag.kind === ts.SyntaxKind.StaticKeyword),
    optional: !!node.questionToken,
    readonly: flags.some((flag) => flag.kind === ts.SyntaxKind.ReadonlyKeyword),
  };
}

function declaredType(node: ts.Node): ts.TypeNode | undefined {
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) ||
      ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return node.type;
  return undefined;
}

function isClassLike(node: ts.Node): node is ts.ClassDeclaration | ts.ClassExpression | ts.InterfaceDeclaration {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node) || ts.isInterfaceDeclaration(node);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

/** Add source-declared members and resolvable type dependencies missing from the upstream graph. */
export async function addClassMetadata(
  repositoryPath: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<void> {
  const byFileAndName = new Map<string, GraphNode[]>();
  const classNodes = nodes.filter((node) => node.labels.some((label) => CLASS_LABELS.has(label)));
  for (const node of classNodes) {
    const key = `${node.filePath}\0${node.name}`;
    byFileAndName.set(key, [...(byFileAndName.get(key) ?? []), node]);
  }
  const byName = new Map<string, GraphNode[]>();
  for (const node of classNodes) byName.set(node.name, [...(byName.get(node.name) ?? []), node]);
  const byQualifiedName = new Map<string, GraphNode[]>();
  for (const node of classNodes) {
    byQualifiedName.set(node.qualifiedName, [...(byQualifiedName.get(node.qualifiedName) ?? []), node]);
  }
  const resolveClass = (name: string, filePath: string): GraphNode | undefined => {
    const candidates = byName.get(name) ?? [];
    return candidates.find((item) => item.filePath === filePath) ??
      (candidates.length === 1 ? candidates[0] : undefined);
  };
  const sources = new Map<string, ts.SourceFile>();
  const paths = new Set(classNodes.map((node) => node.filePath).filter(Boolean));
  for (const filePath of paths) {
    const scriptKind = SCRIPT_KINDS[extname(filePath).toLowerCase()];
    if (scriptKind === undefined) continue;
    try {
      const text = await readFile(resolve(repositoryPath, filePath), "utf8");
      sources.set(filePath, ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind));
    } catch {
      // Keep source-derived metadata absent for unreadable files.
    }
  }
  const dependencies = new Map<string, GraphEdge>();
  const propertyEdges = new Map<string, GraphEdge>();
  const existingDependencyPairs = new Set(edges.filter((edge) => edge.type === "DEPENDS_ON")
    .map((edge) => `${edge.source}\0${edge.target}`));
  const addDependency = (
    source: GraphNode, target: GraphNode, reason: string, member: string, derivedFrom: string,
  ) => {
    if (source.id === target.id) return;
    const pair = `${source.id}\0${target.id}`;
    if (existingDependencyPairs.has(pair)) return;
    const id = `derived:${hash(`${source.id}\0${target.id}\0${reason}\0${member}`)}`;
    dependencies.set(id, {
      id, source: source.id, target: target.id, type: "DEPENDS_ON",
      properties: { derivedFrom, reason, member },
    });
  };

  // Normalize upstream Field nodes regardless of the source language.
  for (const field of nodes.filter((node) => node.labels.includes("Field") || node.labels.includes("Property"))) {
    const parent = field.properties.parent_class;
    if (typeof parent !== "string") continue;
    const candidates = byQualifiedName.get(parent) ?? [];
    const owner = candidates.find((item) => item.filePath === field.filePath) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!owner) continue;
    const visibilityText = propertyText(field, "visibility", "access")?.toLowerCase();
    const member: GraphClassMember = {
      name: field.name,
      kind: "field",
      type: propertyText(field, "return_type", "type", "field_type") ?? null,
      filePath: field.filePath,
      startLine: field.startLine ?? owner.startLine ?? 1,
      endLine: field.endLine ?? field.startLine ?? owner.endLine ?? 1,
      visibility: visibilityText === "private" || visibilityText === "protected" ? visibilityText : "public",
      static: field.properties.static === true || field.properties.is_static === true,
      optional: field.properties.optional === true || field.properties.is_optional === true,
      readonly: field.properties.readonly === true || field.properties.is_readonly === true,
    };
    owner.members = [...(owner.members ?? []), member];
    const edgeId = `derived:${hash(`${owner.id}\0${field.id}\0HAS_PROPERTY`)}`;
    propertyEdges.set(edgeId, {
      id: edgeId, source: owner.id, target: field.id, type: "HAS_PROPERTY",
      properties: { derivedFrom: "upstream-index" },
    });
    if (member.type) {
      for (const typeName of referencedNames(member.type)) {
        const target = resolveClass(typeName, field.filePath);
        if (target) addDependency(owner, target, "field-type", field.name, "upstream-index");
      }
    }
  }

  // Method signature metadata is language-neutral when the upstream indexer provides it.
  for (const method of nodes.filter((node) => node.labels.includes("Method"))) {
    const parent = method.properties.parent_class;
    if (typeof parent !== "string") continue;
    const candidates = byQualifiedName.get(parent) ?? [];
    const owner = candidates.find((item) => item.filePath === method.filePath) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (!owner) continue;
    const parameterTypes = propertyTypes(method.properties.param_types);
    for (const typeText of parameterTypes) {
      for (const typeName of referencedNames(typeText)) {
        const target = resolveClass(typeName, method.filePath);
        if (target) addDependency(owner, target, "method-parameter", method.name, "upstream-index");
      }
    }
    const returnType = propertyText(method, "return_type", "returnType");
    if (returnType) {
      for (const typeName of referencedNames(returnType)) {
        const target = resolveClass(typeName, method.filePath);
        if (target) addDependency(owner, target, "method-return", method.name, "upstream-index");
      }
    }
  }

  for (const [filePath, file] of sources) {
    const visit = (node: ts.Node) => {
      if (!isClassLike(node) || !node.name) {
        ts.forEachChild(node, visit);
        return;
      }
      const name = node.name.text;
      const candidates = byFileAndName.get(`${filePath}\0${name}`) ?? [];
      const start = sourceLine(file, node);
      const owner = candidates.find((candidate) => candidate.startLine === start) ??
        (candidates.length === 1 ? candidates[0] : undefined);
      if (!owner) {
        ts.forEachChild(node, visit);
        return;
      }
      const members: GraphClassMember[] = [];
      const collect = (member: ts.Node) => {
        const value = toMember(file, filePath, member);
        const propertyType = declaredType(member);
        if (value) {
          members.push(value);
          if (propertyType) {
            for (const typeName of typeNames(propertyType)) {
              const target = resolveClass(typeName, filePath);
              if (target) addDependency(owner, target, "field-type", value.name, "typescript-ast");
            }
          }
        }
        if ((ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) &&
            (member.type || member.parameters.length)) {
          for (const parameter of member.parameters) {
            if (!parameter.type) continue;
            for (const typeName of typeNames(parameter.type)) {
              const target = resolveClass(typeName, filePath);
              if (target) addDependency(owner, target, "method-parameter", member.name.getText(file), "typescript-ast");
            }
          }
          if (member.type) {
            for (const typeName of typeNames(member.type)) {
              const target = resolveClass(typeName, filePath);
              if (target) addDependency(owner, target, "method-return", member.name.getText(file), "typescript-ast");
            }
          }
        }
      };
      for (const member of node.members) collect(member);
      for (const member of members) {
        const isAlreadyIndexed = (owner.members ?? []).some((existing) =>
          existing.name === member.name && existing.filePath === member.filePath &&
          existing.startLine === member.startLine && existing.kind === member.kind);
        if (!isAlreadyIndexed) owner.members = [...(owner.members ?? []), member];
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  const classForQualifiedName = (qualifiedName: string, filePath: string) => {
    const candidates = byQualifiedName.get(qualifiedName) ?? [];
    return candidates.find((item) => item.filePath === filePath) ??
      (candidates.length === 1 ? candidates[0] : undefined);
  };
  const methodOwners = new Map(nodes.filter((node) => node.labels.includes("Method") &&
    typeof node.properties.parent_class === "string")
    .map((node) => [node.id, classForQualifiedName(node.properties.parent_class as string, node.filePath)]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges.filter((item) => item.type === "CALLS")) {
    const source = methodOwners.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    const target = targetNode && methodOwners.get(targetNode.id) ||
      (targetNode?.labels.some((label) => CLASS_LABELS.has(label)) ? targetNode : undefined);
    if (source && target) addDependency(source, target, "method-call", targetNode?.name ?? "", "codebase-memory-mcp");
  }
  edges.push(...propertyEdges.values(), ...dependencies.values());
}
