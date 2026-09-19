import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? sourceFiles(path.join(dir, item.name)) : /\.tsx?$/.test(item.name) && !/\.test\./.test(item.name) ? [path.join(dir, item.name)] : []);
}
describe("T1.6.1 inert foundation boundaries", () => {
  it("only package preparation consumes eligibility; no UI, route, provider, selector or compiler integration", () => {
    const callers = new Set<string>();
    for (const file of sourceFiles(path.resolve("src"))) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) && node.text.includes("owner-knowledge-eligibility")) callers.add(path.relative(path.resolve("src"), file).replaceAll("\\", "/"));
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect([...callers].sort()).toEqual(["lib/owner-knowledge-eligibility-listing.ts", "lib/owner-knowledge-eligibility-section.ts", "lib/professional-brain-orchestrator.ts"]);
    const orchestrator = readFileSync("src/lib/professional-brain-orchestrator.ts", "utf8");
    expect(orchestrator.match(/await listOwnerKnowledgeEligibility\(/g)).toHaveLength(1);
    const preparation = orchestrator.slice(orchestrator.indexOf("export async function prepareReasoningRequestPackage"), orchestrator.indexOf("export async function approveReasoningProposal"));
    expect(preparation).toContain("await assertOwnedClient(ownerUserId, clientId)");
    expect(preparation).toContain("await listOwnerKnowledgeEligibility(");
    expect(preparation).not.toMatch(/\.reason\(|createDraftReasoningProposal|findReasoningProposalByFingerprint/);
  });
  it("resolver/section and all runtime dependencies are pure, with no hidden registry, I/O, or provider state", () => {
    const visited = new Set<string>(); const external = new Set<string>();
    function walk(file: string) {
      if (visited.has(file)) return; visited.add(file);
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function calls(node: ts.Node) {
        if (ts.isCallExpression(node)) {
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword);
          if (ts.isIdentifier(node.expression)) expect(["fetch", "require", "eval"]).not.toContain(node.expression.text);
        }
        ts.forEachChild(node, calls);
      }
      calls(ast);
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
    walk(path.resolve("src/lib/owner-knowledge-eligibility-section.ts"));
    expect([...external]).toEqual(["crypto"]);
    expect([...visited].filter(file => /(?:registry|repository|service|provider|prisma)\.ts$/.test(file))).toEqual([]);
  });
  it("listing adds no writes/binding persistence and reuses the T1.5 source authority", () => {
    const source = readFileSync("src/lib/owner-knowledge-eligibility-listing.ts", "utf8");
    expect(source).toContain("await readReviewedProceduralKnowledge(context.ownerUserId, draft.id)");
    expect(source).not.toMatch(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany|\$executeRaw)\s*\(/);
    expect(source).not.toMatch(/\.reason\(|\.generateContent\(|professional-knowledge-registry/);
  });
  // Baseline 19a85dc, normalized line endings only. These are explicitly
  // locked decision/provider consumers for this slice, not new extensions.
  it.each(Object.entries({
    "professional-reasoning-contracts.ts": "9e6e8fd55fe0caaad35ba0e7558b76ee5b65199317467aa7ecfd0eac09dd049f",
    "professional-reasoning-service.ts": "975652220ad24afd9f0b1c6ed43aec3fee47c2d37f48ec4b5127c149bfc5c924",
    "professional-reasoning-provider-gemini.ts": "053dd528bac21720e24f83e22c8f7058359922b51bb052fed86fed21deafb9d5",
    "professional-reasoning-validator.ts": "72d6a8d9466cc002c482d613a5a606378d2466c8799fa141f8536372d37862bb",
    "hair-state-delta-skill-candidate-selector.ts": "f8f05e16fe1dd55b19e7b42a671df6f186dbcfa855fb820fadceae9c5bf7cbf3",
    "professional-execution-plan-compiler.ts": "29340d5f5df972f73d488f3f775a2928fe03942912a79adf0d3b1daf42b24265",
    "professional-execution-scene-compiler.ts": "5489b01c859b273427874dcdde75aa4fb94f1eb7dea2ebe34b24a0b2f134fee1",
    "professional-knowledge-registry.ts": "6730e764b40fa4d00d029bb60b47372975a1d0ac7bee64d1aa5090b3c09043b3",
    "professional-brain-skill-templates.ts": "819fceea81682d9426bbffe6a7cd41feb6e94a06ad7b913d0030d343d635ac1a",
    "professional-reasoning-repository.ts": "b579e482199641abf12fe8def2df78327beffac64abe81b58160f46223f6d99d",
  }))("keeps %s exactly at the approved baseline", (file, fingerprint) => {
    const source = readFileSync(path.join("src/lib", file), "utf8").replaceAll("\r\n", "\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe(fingerprint);
  });
});
