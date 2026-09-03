import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

// Spatial Mapping revisit fix #1 -- source-level structural proofs for
// properties that this codebase's own conventions (no jsdom/testing-library
// -- see vitest.config.ts) cannot assert by actually rendering the
// component or driving real React timing. Mirrors the established
// precedent for exactly this situation (e.g.
// concierge-voice-input-integration.test.ts's own structural proofs,
// orchestrator-service.test.ts's own "source-level lock" tests).
//
// What this DOES prove: the real source code has the shape required --
// manual selection can never be silently overwritten (functional state
// updates only), the restore is genuinely asynchronous (never applied
// before the fetch resolves), and it only ever attempts once per mount
// (never fights a later manual change). The pure DECISION of which scope
// to restore is separately, fully proven in spatial-binding-logic.test.ts.
// What this does NOT prove: literal browser timing -- that is what a real
// browser check confirms, exactly like every other UI-layer proof in this
// project's history.

function readSource(): string {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dirname, "use-spatial-binding-auto-restore.ts"), "utf8");
}

describe("useSpatialBindingAutoRestore -- structural proofs", () => {
  it("4/5/7. manual choice always wins: both setters are called with a FUNCTIONAL updater that only fills an unset (null) value, never a direct overwrite", () => {
    const source = readSource();
    expect(source).toMatch(/setSelectedImageId\(\(current\) => current \?\? restored\.sourceImageAssetId\)/);
    expect(source).toMatch(/setSelectedViewLabel\(\(current\) => current \?\? restored\.viewLabel\)/);
    // Never a bare, unconditional call that would clobber whatever the
    // professional already picked.
    expect(source).not.toMatch(/setSelectedImageId\(restored\.sourceImageAssetId\)/);
    expect(source).not.toMatch(/setSelectedViewLabel\(restored\.viewLabel\)/);
  });

  it("6. the restore is genuinely asynchronous -- the setters are only ever called AFTER awaiting the real fetch, never synchronously on mount", () => {
    const source = readSource();
    const setterIndex = source.indexOf("setSelectedImageId((current)");
    const awaitFetchIndex = source.indexOf("await fetch(");
    expect(awaitFetchIndex).toBeGreaterThan(-1);
    expect(setterIndex).toBeGreaterThan(awaitFetchIndex);
  });

  it("one-shot per mount -- a ref guard prevents a repeated restore attempt from ever re-firing later in the same session", () => {
    const source = readSource();
    expect(source).toMatch(/useRef\(false\)/);
    expect(source).toMatch(/if \(attemptedRef\.current\) return;/);
    expect(source).toMatch(/attemptedRef\.current = true;/);
  });

  it("reuses the EXISTING spatial-bindings list endpoint -- no new API route was created for this fix", () => {
    const source = readSource();
    expect(source).toMatch(/\/api\/v1\/clients\/\$\{clientId\}\/analysis-proposals\/\$\{proposalId\}\/technical-visual-maps\/\$\{technicalVisualMapId\}\/spatial-bindings/);
  });

  it("the pure restore decision (WHICH scope to pick) is imported from spatial-binding-logic.ts, never reimplemented inline", () => {
    const source = readSource();
    expect(source).toMatch(/import \{ resolveAutoRestoreSelection \} from ["']\.\/spatial-binding-logic["']/);
  });

  it("never invents/derives a client id, proposal id, or map id itself -- only forwards the caller-supplied ones", () => {
    const source = readSource();
    expect(source).not.toMatch(/clientId\s*=\s*["'`]/);
    expect(source).not.toMatch(/proposalId\s*=\s*["'`]/);
    expect(source).not.toMatch(/technicalVisualMapId\s*=\s*["'`]/);
  });
});
