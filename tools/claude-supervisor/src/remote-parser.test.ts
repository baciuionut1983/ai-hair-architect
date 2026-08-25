import { describe, expect, it } from "vitest";

import { parseGitHubRemoteUrl } from "./remote-parser.js";

describe("parseGitHubRemoteUrl", () => {
  // Test requirement 17: remote parsing HTTPS.
  it("parses the real HTTPS format this repo's own origin actually uses", () => {
    expect(parseGitHubRemoteUrl("https://github.com/baciuionut1983/ai-hair-architect.git")).toEqual({ owner: "baciuionut1983", repo: "ai-hair-architect" });
  });

  it("parses HTTPS without a trailing .git", () => {
    expect(parseGitHubRemoteUrl("https://github.com/owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses HTTPS with an embedded credential (username@github.com)", () => {
    expect(parseGitHubRemoteUrl("https://user@github.com/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
  });

  // Test requirement 18: remote parsing SSH.
  it("parses the short SSH scp-like form", () => {
    expect(parseGitHubRemoteUrl("git@github.com:owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses SSH without a trailing .git", () => {
    expect(parseGitHubRemoteUrl("git@github.com:owner/repo")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses the ssh:// long form", () => {
    expect(parseGitHubRemoteUrl("ssh://git@github.com/owner/repo.git")).toEqual({ owner: "owner", repo: "repo" });
  });

  it("returns null for a non-GitHub remote, never guessing", () => {
    expect(parseGitHubRemoteUrl("https://gitlab.com/owner/repo.git")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseGitHubRemoteUrl("not a url at all")).toBeNull();
    expect(parseGitHubRemoteUrl("")).toBeNull();
  });
});
