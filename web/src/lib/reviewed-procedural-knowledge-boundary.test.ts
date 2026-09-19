import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? sources(path.join(dir, item.name)) : /\.tsx?$/.test(item.name) && !/\.test\./.test(item.name) ? [path.join(dir, item.name)] : []);
}
describe("T1.5 representation/activation boundary", () => {
  it("the projector and canonical contract have no transitive runtime dependency on I/O, providers, or registries", () => {
    const visited = new Set<string>();
    const external = new Set<string>();
    function walk(file: string) {
      if (visited.has(file)) return;
      visited.add(file);
      const text = readFileSync(file, "utf8");
      const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      function checkCalls(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
          if (ts.isIdentifier(node.expression)) expect(["fetch", "eval", "require"]).not.toContain(node.expression.text);
        }
        ts.forEachChild(node, checkCalls);
      }
      checkCalls(ast);
      for (const node of ast.statements) {
        if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly) && !node.importClause?.name) continue;
        const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
        if (specifier.startsWith("@/")) walk(path.resolve("src", `${specifier.slice(2)}.ts`));
        else if (specifier.startsWith(".")) walk(path.resolve(path.dirname(file), `${specifier}.ts`));
        else external.add(specifier);
      }
    }
    walk(path.resolve("src/lib/reviewed-procedural-knowledge-projector.ts"));
    expect([...external]).toEqual(["crypto"]);
    expect([...visited].filter(file => /(?:registry|repository|service|provider|prisma)\.ts$/.test(file))).toEqual([]);
  });
  it("has no existing consumer imports of the new projection, service, or route", () => {
    const inbound: string[] = [];
    for (const file of sources(path.resolve("src"))) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text.includes("reviewed-procedural-knowledge")) inbound.push(path.relative(path.resolve("src"), file).replaceAll("\\", "/"));
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    const allowed = new Set([
      "lib/professional-knowledge-entry-contracts.ts",
      "lib/reviewed-procedural-knowledge-projector.ts",
      "lib/reviewed-procedural-knowledge-service.ts",
      "lib/owner-knowledge-eligibility.ts",
      "lib/owner-knowledge-eligibility-listing.ts",
      "app/api/v1/learning-drafts/[draftId]/reviewed-procedural-knowledge/route.ts",
    ]);
    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.filter(file => !allowed.has(file))).toEqual([]);
  });
  it("global registry still reads only its code manifest and never private projection/review/evidence", () => {
    const source = readFileSync("src/lib/professional-knowledge-registry.ts", "utf8");
    expect(source).toContain("return buildRealProfessionalKnowledgeEntries();");
    expect(source).not.toMatch(/proceduralReview|reviewed-procedural-knowledge|professional-learning-draft|professional-learning-evidence|prisma|fetch\(/);
  });
  it("new service and route contain no persistence writes or global registry access", () => {
    for (const file of ["src/lib/reviewed-procedural-knowledge-service.ts", "src/app/api/v1/learning-drafts/[draftId]/reviewed-procedural-knowledge/route.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany|\$executeRaw)\s*\(/);
      expect(source).not.toMatch(/professional-knowledge-registry|skill-selector|execution-plan|reasoning-context/);
    }
  });
});
