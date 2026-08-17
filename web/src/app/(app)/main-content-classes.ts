// Isolated from layout.tsx (a "use client" component with several
// non-trivial dependencies) so the safe-area mechanism is independently
// testable without a rendering environment -- no `.test.tsx` render-testing
// convention exists in this repo (see sibling ui/getXClasses helpers for
// the same pattern).
//
// pb-[calc(env(safe-area-inset-bottom)+...)]: layers iPhone's safe-area
// inset on top of the normal bottom padding. A no-op on desktop or any
// non-notched device (env() resolves to 0 there, leaving the base padding
// unchanged) -- otherwise the last on-screen content/controls on any page
// (e.g. Consult AI's composer and Teach the AI panel, at the bottom of the
// client detail page) could end up flush against, or partly under,
// iPhone's home-indicator area.
export function getMainContentClasses(): string {
  return "flex-1 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:p-8 md:pb-[calc(env(safe-area-inset-bottom)+2rem)]";
}
