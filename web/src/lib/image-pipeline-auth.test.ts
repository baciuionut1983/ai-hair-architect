import { describe, expect, it } from "vitest";

import { getImagePipelineAuthToken, ImagePipelineAuthNotConfiguredError } from "./image-pipeline-auth";

describe("getImagePipelineAuthToken", () => {
  it("always throws ImagePipelineAuthNotConfiguredError, never silently returns a token", () => {
    expect(() => getImagePipelineAuthToken()).toThrow(ImagePipelineAuthNotConfiguredError);
  });

  it("throws a message pointing at the unresolved decision, not a generic error", () => {
    expect(() => getImagePipelineAuthToken()).toThrow(/authentication strategy is not yet decided/);
  });
});
