import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
describe.each(["professional-field-review-candidates", "professional-field-specification-governance"])("%s inert architecture", moduleName => {
  it("has zero source consumers: routes, UI, Brain, provider, selector, compiler, TD, video and consult", () => {
    const consumers: string[] = [];
    for (const file of sources(path.resolve("src"))) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteralLike(node) && node.text.includes(moduleName)) consumers.push(file);
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(consumers).toEqual([]);
  });
  it("permits only Node hashing and the existing pure validator graph, no persistence or registry", () => {
    const visited = new Set<string>();
    const externals = new Set<string>();
    function walk(file: string) {
      if (visited.has(file)) return;
      visited.add(file);
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
          if (ts.isIdentifier(node.expression)) expect(["fetch", "require", "eval", "Function", "setTimeout", "setInterval"]).not.toContain(node.expression.text);
        }
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) expect(["Function", "XMLHttpRequest", "WebSocket", "Worker"]).not.toContain(node.expression.text);
        if (ts.isIdentifier(node)) expect(["process", "globalThis", "window", "document"]).not.toContain(node.text);
        if (ts.isExportDeclaration(node)) expect(node.moduleSpecifier).toBeUndefined();
        ts.forEachChild(node, visit);
      }
      visit(ast);
      for (const node of ast.statements) {
        if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly) && !node.importClause?.name) continue;
        const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
        if (specifier === "node:crypto") {
          expect(bindings && ts.isNamedImports(bindings) && bindings.elements.map(e => e.name.text)).toEqual(["createHash"]);
          externals.add(specifier);
        } else {
          expect(specifier.startsWith("@/lib/")).toBe(true);
          walk(path.resolve("src", `${specifier.slice(2)}.ts`));
        }
      }
    }
    walk(path.resolve(`src/lib/${moduleName}.ts`));
    expect([...externals]).toEqual(["node:crypto"]);
    expect([...visited].map(file => path.basename(file)).sort()).toEqual([
      `${moduleName}.ts`, "professional-learning-draft-validators.ts", "proposal-validators.ts", "structured-professional-field-claims.ts",
    ].sort());
  });
});
