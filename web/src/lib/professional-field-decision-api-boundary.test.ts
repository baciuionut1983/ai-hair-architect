import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
function runtimeSpecifiers(ast: ts.SourceFile) {
  const result: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) return;
      const bindings = node.importClause?.namedBindings;
      if (!node.importClause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.every(item => item.isTypeOnly)) return;
      result.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      if (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(item => item.isTypeOnly)) return;
      result.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(ast) === "require") && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) result.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(ast); return result;
}
describe("b.2 server and downstream boundary", () => {
  it("has exactly the two authorized handlers and only adapter dependencies", () => {
    const root = path.resolve("src/app/api/v1/learning-drafts/[draftId]/professional-field-decisions");
    const routes = sources(root).sort();
    expect(routes).toEqual([path.join(root, "[field]/route.ts"), path.join(root, "route.ts")].sort());
    for (const file of routes) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const exports = ast.statements.filter(ts.isFunctionDeclaration).filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).map(node => node.name?.text);
      expect(exports).toEqual([file.includes("[field]") ? "POST" : "GET"]);
      expect(runtimeSpecifiers(ast).sort()).toEqual([
        "@/lib/session-request-auth", "@/lib/professional-field-claim-decision-service", "@/lib/professional-field-decision-http",
        ...(file.includes("[field]") ? ["@/lib/hardening"] : []),
      ].sort());
    }
    const helper = path.resolve("src/lib/professional-field-decision-http.ts");
    expect(runtimeSpecifiers(ts.createSourceFile(helper, readFileSync(helper, "utf8"), ts.ScriptTarget.Latest, true)).sort()).toEqual(["@/lib/professional-field-claim-decision-service", "@prisma/client"].sort());
  });
  it("no client runtime graph imports candidate, governance or decision authority", () => {
    const files = sources(path.resolve("src"));
    const graph = new Map<string, string[]>(); const clients: string[] = [];
    for (const file of files) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      if (ast.statements.some(node => ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === "use client")) clients.push(file);
      const dependencies = runtimeSpecifiers(ast).flatMap(specifier => {
        const base = specifier.startsWith("@/") ? path.resolve("src", specifier.slice(2)) : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
        if (!base) return [];
        const resolved = [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")].find(existsSync);
        return resolved ? [resolved] : [];
      });
      graph.set(file, dependencies);
    }
    const forbidden = new Set(["professional-field-review-candidates.ts", "professional-field-specification-governance.ts", "professional-field-claim-decision-service.ts"].map(file => path.resolve("src/lib", file)));
    for (const client of clients) {
      const seen = new Set<string>();
      function walk(file: string) {
        if (seen.has(file)) return; seen.add(file);
        expect(forbidden.has(file), `${client} reaches ${file}`).toBe(false);
        for (const dependency of graph.get(file) ?? []) walk(dependency);
      }
      walk(client);
    }
  });
});
