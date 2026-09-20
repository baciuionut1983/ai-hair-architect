import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? sources(path.join(dir, item.name)) : /\.tsx?$/.test(item.name) && !/\.test\./.test(item.name) ? [path.join(dir, item.name)] : []);
}
describe("T1.6.2.a architecture boundary", () => {
  it("allows only inert candidate/governance dependencies, never Brain, UI, routes, video or consult", () => {
    const consumers: string[] = [];
    for (const file of sources(path.resolve("src"))) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text.includes("structured-professional-field-claims")) consumers.push(file);
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(consumers.sort()).toEqual([
      path.resolve("src/lib/professional-field-review-candidates.ts"),
      path.resolve("src/lib/professional-field-specification-governance.ts"),
    ].sort());
  });
  it("transitive runtime dependency graph is pure primitive validators only", () => {
    const visited = new Set<string>();
    function walk(file: string) {
      if (visited.has(file)) return;
      visited.add(file);
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function check(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
          if (ts.isIdentifier(node.expression)) expect(["fetch", "require", "eval"]).not.toContain(node.expression.text);
        }
        ts.forEachChild(node, check);
      }
      check(ast);
      for (const node of ast.statements) {
        if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings) && bindings.elements.every(e => e.isTypeOnly) && !node.importClause?.name) continue;
        const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
        expect(specifier.startsWith("@/lib/")).toBe(true);
        walk(path.resolve("src", `${specifier.slice(2)}.ts`));
      }
    }
    walk(path.resolve("src/lib/structured-professional-field-claims.ts"));
    expect([...visited].map(file => path.basename(file)).sort()).toEqual([
      "professional-learning-draft-validators.ts", "proposal-validators.ts", "structured-professional-field-claims.ts",
    ]);
  });
  // Approved production baseline 609f8d1. Deliberate future revisions only.
  it.each(Object.entries({
    "professional-learning-procedural-review-validators.ts": "12b3488504aa15a8e949fdc7d98d937b62ca8435ecfdc500bb05733760218c3b",
    "professional-learning-draft-repository.ts": "1e75d8a8492c2b5a0f845e7bf919e02a4ef2f3094debe2ef062a374f64ded98c",
    "reviewed-procedural-knowledge-projector.ts": "230695d19a19ff477c40e46238123aa503e27c3c19e09815d15fe324d2c5d8d7",
    "owner-knowledge-eligibility.ts": "41ec66b7696d11dafefc5dc4921c843c18bca2e715a80bd01e676684b5aa9655",
    "owner-knowledge-eligibility-listing.ts": "dcb8611a0efd3ca3f4ec2c6fe332ab7e7484a7e6d9abb233c6cb1fed047c4bea",
    "owner-knowledge-eligibility-section.ts": "567d12ac254743714e7a2c48ff77dae43b7246d53fcb92b4918ded26401c07a4",
    "professional-brain-orchestrator.ts": "c5f7013fd4b89a0b33c80eb9f6dca40faccd43a1e046d3b53e90eb7eb8faff31",
    "professional-reasoning-contracts.ts": "9e6e8fd55fe0caaad35ba0e7558b76ee5b65199317467aa7ecfd0eac09dd049f",
    "professional-reasoning-provider-gemini.ts": "053dd528bac21720e24f83e22c8f7058359922b51bb052fed86fed21deafb9d5",
    "professional-execution-plan-compiler.ts": "29340d5f5df972f73d488f3f775a2928fe03942912a79adf0d3b1daf42b24265",
    "professional-execution-scene-compiler.ts": "5489b01c859b273427874dcdde75aa4fb94f1eb7dea2ebe34b24a0b2f134fee1",
    "professional-knowledge-registry.ts": "6730e764b40fa4d00d029bb60b47372975a1d0ac7bee64d1aa5090b3c09043b3",
  }))("preserves protected %s unchanged", (file, digest) => {
    expect(createHash("sha256").update(readFileSync(path.join("src/lib", file), "utf8").replaceAll("\r\n", "\n")).digest("hex")).toBe(digest);
  });
});
