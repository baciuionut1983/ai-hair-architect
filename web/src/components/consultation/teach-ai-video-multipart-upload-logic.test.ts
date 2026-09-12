import { describe, expect, it, vi } from "vitest";

import { computeUploadPartRanges, generateVideoUploadSessionId, uploadVideoViaMultipart, type VideoUploadProgressState } from "@/components/consultation/teach-ai-video-multipart-upload-logic";

function fakeVideoFile(sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], "demo.mp4", { type: "video/mp4" });
}

describe("computeUploadPartRanges (pure)", () => {
  it("30. produces one range for a file smaller than one part", () => {
    expect(computeUploadPartRanges(1024, 16 * 1024 * 1024)).toEqual([{ partNumber: 1, start: 0, end: 1024 }]);
  });

  it("produces multiple ranges spanning the full file, in order, with a real final range", () => {
    const ranges = computeUploadPartRanges(2500, 1000);
    expect(ranges).toEqual([
      { partNumber: 1, start: 0, end: 1000 },
      { partNumber: 2, start: 1000, end: 2000 },
      { partNumber: 3, start: 2000, end: 2500 },
    ]);
  });
});

describe("generateVideoUploadSessionId", () => {
  it("produces a distinct id each call", () => {
    expect(generateVideoUploadSessionId()).not.toBe(generateVideoUploadSessionId());
  });
});

describe("uploadVideoViaMultipart (28/29/30/37: never buffers the whole file, honest progress phases)", () => {
  it("28/29. never reads the file's full bytes through this app's own fetch -- only the presigned URL PUT receives a body slice", async () => {
    const file = fakeVideoFile(2500);
    const putBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/video-upload-sessions") && !url.includes("fake-s3") && init?.method === "POST" && !url.includes("/parts") && !url.includes("/complete")) {
        return new Response(JSON.stringify({ sessionId: "s-1", partSizeBytes: 1000, partCount: 3 }), { status: 201 });
      }
      if (url.includes("/parts")) {
        const body = JSON.parse(String(init?.body)) as { partNumber: number };
        return new Response(JSON.stringify({ url: `https://fake-s3.test/part-${body.partNumber}`, partNumber: body.partNumber, expiresInSeconds: 900 }), { status: 200 });
      }
      if (url.startsWith("https://fake-s3.test/")) {
        putBodies.push(init?.body);
        return new Response(null, { status: 200, headers: { ETag: '"fake-etag"' } });
      }
      if (url.includes("/complete")) {
        return new Response(JSON.stringify({ evidence: { id: "evidence-1", evidenceType: "VIDEO", title: null, vertical: "unspecified", status: "ACTIVE", createdAt: "2026-09-15T00:00:00.000Z" } }), {
          status: 201,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const progress: VideoUploadProgressState[] = [];
    let succeeded: unknown;
    await uploadVideoViaMultipart(
      "client-1",
      file,
      {},
      { fetch: fetchMock as unknown as typeof fetch },
      { onProgress: (state) => progress.push(state), onSuccess: (evidence) => (succeeded = evidence), onFailure: () => {}, onCanceled: () => {} },
      new AbortController().signal,
      "s-1",
    );

    expect(succeeded).toEqual(expect.objectContaining({ id: "evidence-1" }));
    expect(putBodies).toHaveLength(3);
    // Every PUT body is a real Blob slice, never the whole 2500-byte file
    // re-read as one buffer.
    for (const body of putBodies) {
      expect(body).toBeInstanceOf(Blob);
      expect((body as Blob).size).toBeLessThanOrEqual(1000);
    }
  });

  it("37. reports the honest phase sequence: preparing -> uploading (with % ) -> finalizing -> saved", async () => {
    const file = fakeVideoFile(500);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/parts")) return new Response(JSON.stringify({ url: "https://fake-s3.test/part-1", partNumber: 1, expiresInSeconds: 900 }), { status: 200 });
      if (url.startsWith("https://fake-s3.test/")) return new Response(null, { status: 200, headers: { ETag: '"e1"' } });
      if (url.includes("/complete")) return new Response(JSON.stringify({ evidence: { id: "evidence-1" } }), { status: 201 });
      return new Response(JSON.stringify({ sessionId: "s-1", partSizeBytes: 16 * 1024 * 1024, partCount: 1 }), { status: 201 });
    });

    const phases: string[] = [];
    await uploadVideoViaMultipart(
      "client-1",
      file,
      {},
      { fetch: fetchMock as unknown as typeof fetch },
      { onProgress: (state) => phases.push(state.phase), onSuccess: () => {}, onFailure: () => {}, onCanceled: () => {} },
      new AbortController().signal,
      "s-1",
    );

    expect(phases).toEqual(["preparing", "uploading", "uploading", "finalizing", "saved"]);
  });

  it("38 (Part 22 UX). never reports a forbidden 'Analyzing'/'Learning'/'Understanding' phase -- only the 6 real ones exist in the type", async () => {
    const file = fakeVideoFile(500);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "INVALID_MIMETYPE" }), { status: 400 }));

    let failureMessage = "";
    await uploadVideoViaMultipart(
      "client-1",
      file,
      {},
      { fetch: fetchMock as unknown as typeof fetch },
      { onProgress: () => {}, onSuccess: () => {}, onFailure: (message) => (failureMessage = message), onCanceled: () => {} },
      new AbortController().signal,
      "s-1",
    );

    expect(failureMessage).not.toBe("");
    for (const forbidden of ["analiz", "învăț", "learn", "understand"]) {
      expect(failureMessage.toLocaleLowerCase()).not.toContain(forbidden);
    }
  });

  it("cancel: an already-aborted signal stops before any part upload and calls the abort endpoint", async () => {
    const file = fakeVideoFile(2500);
    const abortCalls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/abort")) {
        abortCalls.push(url);
        return new Response(JSON.stringify({ aborted: true }), { status: 200 });
      }
      if (url.startsWith("https://fake-s3.test/")) throw new Error("must never upload a part after cancel");
      return new Response(JSON.stringify({ sessionId: "s-1", partSizeBytes: 1000, partCount: 3 }), { status: 201 });
    });

    const controller = new AbortController();
    controller.abort();

    let canceled = false;
    await uploadVideoViaMultipart(
      "client-1",
      file,
      {},
      { fetch: fetchMock as unknown as typeof fetch },
      { onProgress: () => {}, onSuccess: () => {}, onFailure: () => {}, onCanceled: () => (canceled = true) },
      controller.signal,
      "s-1",
    );

    expect(canceled).toBe(true);
    expect(abortCalls).toHaveLength(1);
  });
});
