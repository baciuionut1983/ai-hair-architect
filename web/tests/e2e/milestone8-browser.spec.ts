import { expect, test } from "@playwright/test";

test("milestone8 technical plan persists after reload", async ({ page }) => {
  const nonce = Date.now();
  const email = `m8-browser-${nonce}@example.com`;

  await page.goto("/");

  const authCard = page.locator("#milestone1 .milestone-card").nth(1);
  await authCard.locator("input[placeholder='Email']").fill(email);
  await authCard.locator("input[placeholder='Password (min 8)']").fill("Passw0rd!123");
  await authCard.locator("select").selectOption("professional");
  await authCard.locator("button", { hasText: "Register" }).click();
  await expect(page.locator("#milestone1")).toContainText("Session: signed in as", { timeout: 15000 });

  await page.locator("#milestone1 input[placeholder='Full name']").fill("Milestone 8 Browser Client");
  await page.locator("#milestone1 button", { hasText: "Create client" }).click();
  await expect(page.locator("#milestone1")).toContainText("Milestone 8 Browser Client", { timeout: 15000 });

  await page.locator("#milestone2 button", { hasText: "Refresh clients" }).click();

  const analysisSection = page.locator("#milestone2");
  await analysisSection.locator("select").nth(0).selectOption({ label: "Milestone 8 Browser Client" });
  await analysisSection.locator("select").nth(1).selectOption("reshape");
  await analysisSection.locator("select").nth(5).selectOption("round");
  await analysisSection.locator("select").nth(6).selectOption("balanced");
  await analysisSection.locator("select").nth(7).selectOption("medium");
  await analysisSection.locator("select").nth(8).selectOption("curly");
  await analysisSection.locator("select").nth(9).selectOption("virgin_healthy");
  await analysisSection.locator("select").nth(10).selectOption("regular");
  await analysisSection.locator("select").nth(11).selectOption("graduated_bob");

  await analysisSection.locator("button", { hasText: "Start analysis" }).click();

  await expect(analysisSection).toContainText("Technical cut plan");
  await expect(analysisSection).toContainText("Structural technique:");
  await expect(analysisSection).toContainText("Cutting technique:");
  await expect(analysisSection).toContainText("Sectioning:");
  await expect(analysisSection).toContainText("Elevation:");
  await expect(analysisSection).toContainText("Distribution:");
  await expect(analysisSection).toContainText("Guideline:");
  await expect(analysisSection).toContainText("Stylist explanation");
  await expect(analysisSection).toContainText("Client explanation");

  await analysisSection.locator("button", { hasText: "Save consultation" }).click();
  await expect(analysisSection).toContainText("Consultation saved.");

  await page.reload();
  await expect(page.locator("#milestone2")).toContainText("Technical cut plan");
  await expect(page.locator("#milestone2")).toContainText("Structural technique:");
  await expect(page.locator("#milestone2")).toContainText("Stylist explanation");
});
