import { describe, expect, it } from "vitest";

import { isValidAnalysisWindow, isWithinCoreInterval, planLongVideoWindows, processWindowsIndependently } from "./professional-learning-video-long-window-planner";

const SOURCE = "evidence-long-1";

describe("professional-learning-video-long-window-planner (Stage 8.5L5.R2)", () => {
  describe("planLongVideoWindows", () => {
    it("Section 56.1/9: stable ids -- identical input always produces identical window ids (determinism)", () => {
      const planA = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      const planB = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      expect(planB.windows.map((w) => w.id)).toEqual(planA.windows.map((w) => w.id));
    });

    it("Section 56.2: same source/config -> same segmentation; a different config -> different ids", () => {
      const base = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      const differentVersion = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v2" });
      expect(differentVersion.windows[0].id).not.toBe(base.windows[0].id);
    });

    it("core intervals are contiguous, non-overlapping, and cover the whole duration exactly once", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      expect(plan.windows[0].coreInterval.timeStartSeconds).toBe(0);
      expect(plan.windows.at(-1)!.coreInterval.timeEndSeconds).toBe(671);
      for (let i = 1; i < plan.windows.length; i++) {
        expect(plan.windows[i].coreInterval.timeStartSeconds).toBe(plan.windows[i - 1].coreInterval.timeEndSeconds);
      }
    });

    it("context intervals extend each core by the margin, clamped to [0, totalDuration]", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      expect(plan.windows[0].contextInterval.timeStartSeconds).toBe(0); // clamped, core already starts at 0
      expect(plan.windows.at(-1)!.contextInterval.timeEndSeconds).toBe(671); // clamped
      expect(plan.windows[2].contextInterval.timeStartSeconds).toBe(plan.windows[2].coreInterval.timeStartSeconds - 20);
      expect(plan.windows[2].contextInterval.timeEndSeconds).toBe(plan.windows[2].coreInterval.timeEndSeconds + 20);
    });

    it("every produced window is independently valid (structural + tamper-evidence check)", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      for (const window of plan.windows) {
        expect(isValidAnalysisWindow(window)).toBe(true);
      }
    });

    it("rejects invalid configuration (non-positive duration, non-positive window count, negative margin)", () => {
      expect(() => planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 0, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" })).toThrow();
      expect(() => planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 0, contextMarginSeconds: 20, segmentationVersion: "v1" })).toThrow();
      expect(() => planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: -1, segmentationVersion: "v1" })).toThrow();
    });

    it("a single-window plan degenerates cleanly (core == context == full duration)", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 1, contextMarginSeconds: 20, segmentationVersion: "v1" });
      expect(plan.windows).toHaveLength(1);
      expect(plan.windows[0].coreInterval).toEqual({ timeStartSeconds: 0, timeEndSeconds: 671 });
      expect(plan.windows[0].contextInterval).toEqual({ timeStartSeconds: 0, timeEndSeconds: 671 });
    });
  });

  describe("isValidAnalysisWindow tamper-evidence", () => {
    it("rejects a window whose id does not match a recomputed hash", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      expect(isValidAnalysisWindow({ ...plan.windows[0], id: "spoofed" })).toBe(false);
    });
  });

  describe("isWithinCoreInterval -- the single rule that prevents duplicate observation ownership (Section 17)", () => {
    it("a time exactly at a window's core boundary belongs to exactly one window, never both neighbors", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      const boundary = plan.windows[0].coreInterval.timeEndSeconds; // == plan.windows[1].coreInterval.timeStartSeconds
      expect(isWithinCoreInterval(boundary, plan.windows[0])).toBe(false); // end is exclusive
      expect(isWithinCoreInterval(boundary, plan.windows[1])).toBe(true); // start is inclusive
    });

    it("a time in the context-only portion of a window is NOT within that window's own core", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      const window2 = plan.windows[1];
      const contextOnlyTime = window2.contextInterval.timeStartSeconds + 1; // inside context, before core start
      expect(contextOnlyTime).toBeLessThan(window2.coreInterval.timeStartSeconds);
      expect(isWithinCoreInterval(contextOnlyTime, window2)).toBe(false);
    });
  });

  describe("processWindowsIndependently -- failure isolation (Section 10)", () => {
    it("one window's processor throwing never discards or mutates another window's success", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      const outcome = processWindowsIndependently(plan.windows, (window) => {
        if (window.index === 2) throw new Error("boom");
        return `ok:${window.index}`;
      });
      expect(outcome.succeeded.map((s) => s.windowId)).toEqual([plan.windows[0].id, plan.windows[1].id, plan.windows[3].id, plan.windows[4].id]);
      expect(outcome.failed).toEqual([{ windowId: plan.windows[2].id, error: "boom" }]);
    });

    it("reprocessing only the failed window does not require re-touching the others", () => {
      const plan = planLongVideoWindows({ sourceEvidenceId: SOURCE, totalDurationSeconds: 671, windowCount: 5, contextMarginSeconds: 20, segmentationVersion: "v1" });
      const failedWindow = plan.windows[2];
      const retry = processWindowsIndependently([failedWindow], () => "ok-now");
      expect(retry.succeeded).toEqual([{ windowId: failedWindow.id, result: "ok-now" }]);
    });
  });
});
