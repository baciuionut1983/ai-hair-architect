import type { Viewport } from "next";

// Isolated from layout.tsx (which also imports next/font/google, not
// importable in a plain Vitest run) so this is independently testable.
//
// viewportFit: "cover" (mobile audit): without this, iOS Safari never
// reports a nonzero env(safe-area-inset-*) at all -- it only does once the
// page has explicitly opted into drawing under the notch/home-indicator
// area via viewport-fit=cover. Every env(safe-area-inset-bottom) usage
// added this round (see (app)/main-content-classes.ts, Sidebar's mobile
// nav) depends on this being set here, app-wide, exactly once.
export const APP_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
