import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const servicePath = path.resolve("src/lib/professional-field-claim-decision-service.ts");
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(path.join(dir, entry.name)) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path.join(dir, entry.name)] : []);
}
describe("b.1 persistence boundary", () => {
  it("has no production consumer and no table access outside its service", () => {
    const consumers: string[] = []; const tableUsers = new Set<string>();
    for (const file of sources(path.resolve("src"))) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isStringLiteralLike(node) && node.text.includes("professional-field-claim-decision-service")) consumers.push(file);
        if (ts.isIdentifier(node) && node.text === "professionalFieldClaimDecision") tableUsers.add(file);
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(consumers).toEqual([]);
    expect([...tableUsers]).toEqual([servicePath]);
  });
  it("only uses read/insert DB operations, with no raw SQL, mutation, storage, provider or registry imports", () => {
    const ast = ts.createSourceFile(servicePath, readFileSync(servicePath, "utf8"), ts.ScriptTarget.Latest, true);
    const imports: string[] = []; const operations: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) imports.push((node.moduleSpecifier as ts.StringLiteral).text);
      if (ts.isCallExpression(node)) {
        expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
        if (ts.isIdentifier(node.expression)) expect(["fetch", "require", "eval", "Function"]).not.toContain(node.expression.text);
        if (ts.isPropertyAccessExpression(node.expression)) {
          expect(["update", "updateMany", "delete", "deleteMany", "upsert", "$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"]).not.toContain(node.expression.name.text);
          if (node.expression.expression.getText(ast).startsWith("tx.")) operations.push(node.expression.name.text);
          if (node.expression.name.text === "matchesSpecificationGolden") expect(node.arguments).toHaveLength(1);
        }
        if (ts.isIdentifier(node.expression) && node.expression.text === "matchesSpecificationGolden") expect(node.arguments).toHaveLength(1);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect([...new Set(operations)].sort()).toEqual(["create", "findFirst", "findMany"]);
    expect(imports.sort()).toEqual([
      "@prisma/client", "@/lib/prisma", "@/lib/structured-professional-field-claims", "@/lib/professional-field-review-candidates",
      "@/lib/professional-field-specification-governance", "@/lib/professional-learning-evidence-validators",
    ].sort());
  });
  it("migration adds only the table, three indexes and ownership FK", () => {
    const sql = readFileSync("prisma/migrations/20260921000000_professional_field_claim_decisions/migration.sql", "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE)\b(?! RESTRICT)/);
    const statements = sql.split(";").map(statement => statement.trim()).filter(Boolean);
    expect(statements).toHaveLength(5);
    expect(statements[0]).toMatch(/^CREATE TABLE "ProfessionalFieldClaimDecision"/);
    expect(statements.slice(1, 4).every(statement => /^CREATE (UNIQUE )?INDEX/.test(statement))).toBe(true);
    expect(statements[4]).toMatch(/^ALTER TABLE "ProfessionalFieldClaimDecision" ADD CONSTRAINT/);
    expect(statements[4]).toContain('FOREIGN KEY ("draftId", "ownerUserId") REFERENCES "ProfessionalLearningDraft"("id", "ownerUserId")');
  });
});
