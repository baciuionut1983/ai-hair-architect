import { describe, expect, it } from "vitest";

import { APP_VIEWPORT } from "./viewport-config";

describe("APP_VIEWPORT", () => {
  it("opts into viewport-fit=cover, the only way env(safe-area-inset-*) resolves to a nonzero value on iOS", () => {
    expect(APP_VIEWPORT.viewportFit).toBe("cover");
  });

  it("keeps the standard device-width/initialScale defaults", () => {
    expect(APP_VIEWPORT.width).toBe("device-width");
    expect(APP_VIEWPORT.initialScale).toBe(1);
  });
});
