/* eslint-disable @typescript-eslint/no-require-imports */
// Run from web after npm run build. Uses installed tools, loopback fixtures only,
// actual LearningDraftReview + production CSS, and no database/provider calls.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const { build } = require("esbuild");
const { chromium } = require("@playwright/test");

async function main() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "t162c-browser-"));
  const bundle = await build({ stdin: { contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {UiLanguageProvider} from './src/lib/ui-language-context';
    import {LearningDraftReview} from './src/components/consultation/teach-ai-learning-draft-review';
    function App(){ const [language,setLanguage]=useState('ro'); return <UiLanguageProvider language={language}>
      <nav><button className="min-h-11 p-2" onClick={()=>setLanguage('ro')}>RO</button><button className="min-h-11 p-2" onClick={()=>setLanguage('en')}>EN</button></nav>
      <main className="mx-auto max-w-3xl min-w-0 p-2"><LearningDraftReview evidenceId="fixture"/></main>
    </UiLanguageProvider>}; createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", tsconfig: "tsconfig.json", define: { "process.env": "{}", "process.env.NODE_ENV": '"production"' } });
  const chunks = path.resolve(".next/static/chunks");
  const css = fs.readdirSync(chunks).filter(f => f.endsWith(".css")).map(f => fs.readFileSync(path.join(chunks, f), "utf8")).join("\n");
  assert(css.length > 1000, "Production CSS required");
  const server = http.createServer((req, res) => {
    if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); }
    else { res.setHeader("Content-Type", "text/html"); res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  let checks = 0;
  try {
    for (const width of [320, 375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const pageErrors = []; page.on("pageerror", error => { pageErrors.push(error.message); console.error("Browser error:", error.message); });
      const longToken = "future_" + "canonical".repeat(35);
      const decision = { field: "elevation", revision: 2, decision: "CORRECTED", professionalValue: "45_deg_graduation", note: "Previous professional note\n" + "longtext".repeat(30), createdAt: "2026-09-20T10:00:00Z" };
      const field = (name, resolution, value, values) => ({ field: name, review: { reviewable: true, candidate: { resolution, normalizedValue: resolution === "CANONICAL" ? value : null, observation: { value, source: "OBSERVED", confidence: 0.72, rawObservation: "Long AI observation " + "unbroken".repeat(45) }, pins: { observationDigest: "observation", observationDigestVersion: "v", specificationVersion: "v", specificationDigest: "spec" } } }, specification: { version: "v", digest: "spec", allowedValues: values }, latestRevision: 0, authority: "NONE", latest: null, staleReason: null, actions: { canSubmit: true, allowedDecisions: resolution === "CANONICAL" ? ["CONFIRMED", "CORRECTED", "UNKNOWN", "REJECTED"] : ["CORRECTED", "UNKNOWN", "REJECTED"] }, history: [], historyTruncated: false });
      const fields = [field("elevation", "UNRESOLVED_TEXT", "45° Interior", ["0_deg_blunt", "45_deg_graduation", longToken]), field("sectioning", "CANONICAL", "diagonal_back", ["diagonal_back", "pivot_radial"]), field("guideType", "CANONICAL", "stationary", ["stationary", "traveling"])];
      fields[0] = { ...fields[0], latestRevision: 2, authority: "STALE", latest: decision, history: [decision, { ...decision, revision: 1 }], historyTruncated: true, staleReason: "OBSERVATION_DIGEST_MISMATCH" };
      const draft = { id: "fixture-draft", status: "APPROVED", discernmentCategory: "PROFESSIONAL_TECHNIQUE", comparisonOutcome: "POSSIBLE_NEW_SKILL", comparedSkillId: null, extraction: {}, temporalEvidence: null, proceduralInterpretation: null, reviewableProceduralClaims: [], proceduralReview: null, proceduralReviewRevision: 0, conflictDetail: null };
      const posts = [];
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === "/api/v1/learning-evidence/fixture/drafts") return route.fulfill({ json: { drafts: [draft] } });
        if (url.pathname.includes("professional-field-decisions")) {
          if (route.request().method() === "POST") { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 400, json: { error: "INVALID_REQUEST", message: "Never display backend detail" } }); }
          return route.fulfill({ json: { draftId: draft.id, lifecycle: { open: true, blockedBy: null }, fields } });
        }
        return route.continue();
      });
      await page.goto(origin);
      await page.waitForFunction(() => document.querySelector("main"), { timeout: 10000 });
      await page.locator("main button").first().click();
      for (const language of ["ro", "en"]) {
        await page.getByRole("button", { name: language.toUpperCase(), exact: true }).click();
        const section = page.getByRole("region", { name: language === "ro" ? "Revizuirea câmpurilor tehnice" : "Technical field review" });
        await section.waitFor();
        const card = section.locator("article").first();
        assert(await card.getByText(language === "ro" ? "Necesită revizuire nouă" : "Needs re-review", { exact: true }).isVisible());
        assert.equal(await card.locator('input[value="CONFIRMED"]').count(), 0);
        const before = posts.length;
        await card.getByRole("radio", { name: language === "ro" ? "Corectează" : "Correct", exact: true }).check();
        const select = card.getByRole("combobox"); assert.equal(await select.inputValue(), "");
        const save = card.getByRole("button", { name: language === "ro" ? "Salvează decizia" : "Save decision" }); assert(await save.isDisabled());
        assert.equal(posts.length, before);
        await select.selectOption(longToken);
        const note = card.getByRole("textbox"); await note.fill("  Professional judgment\n" + "note".repeat(60));
        await select.focus(); await page.keyboard.press("Tab"); assert(await note.evaluate(el => el === document.activeElement));
        await page.keyboard.press("Tab"); assert(await save.evaluate(el => el === document.activeElement));
        await card.locator("summary").filter({ hasText: language === "ro" ? "Detalii AI" : "AI details" }).click();
        await card.locator("summary").filter({ hasText: language === "ro" ? "Istoric" : "History" }).click();
        assert(await card.getByText(language === "ro" ? "Există și decizii mai vechi care nu sunt afișate aici." : "Older decisions also exist and are not shown here.").isVisible());
        const measurements = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, overflows: [...document.querySelectorAll('section article, section select, section textarea')].filter(el => el.getBoundingClientRect().right > innerWidth || (el.tagName !== "SELECT" && el.scrollWidth > el.clientWidth + 1)).map(el => ({tag:el.tagName,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,client:el.clientWidth})) }));
        assert(measurements.page <= width, JSON.stringify(measurements)); assert.deepEqual(measurements.overflows, []);
        await save.scrollIntoViewIfNeeded(); assert(await save.isVisible());
        await page.screenshot({ path: path.join(output, `${width}-${language}.png`), fullPage: true });
        await save.click(); await card.getByRole("alert").filter({ hasText: language === "ro" ? "Verifică informațiile introduse." : "Check the entered information." }).waitFor();
        assert.equal(posts.at(-1).correctedValue, longToken); assert((await note.inputValue()).startsWith("  Professional")); assert.equal(await page.getByText("Never display backend detail").count(), 0);
        // Switch action before the next language pass to prove a fresh empty select.
        await card.getByRole("radio", { name: language === "ro" ? "Nu se poate stabili" : "Cannot determine", exact: true }).check();
        await card.locator("summary").filter({ hasText: language === "ro" ? "Detalii AI" : "AI details" }).click();
        await card.locator("summary").filter({ hasText: language === "ro" ? "Istoric" : "History" }).click();
        checks++; console.log(`PASS ${width}px ${language}: wrapping, hierarchy, stale text, explicit correction, note, keyboard, save, history, escaped error`);
      }
      assert.deepEqual(pageErrors, []);
      await page.close();
    }
    console.log(JSON.stringify({ checks, screenshots: output }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
