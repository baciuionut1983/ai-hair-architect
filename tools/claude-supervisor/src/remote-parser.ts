// Pure parsing of a `git remote get-url origin` value into a GitHub
// owner/repo pair -- see ci-watch.ts's own deriveOwnerRepoFromGit for the
// real-I/O caller. Supports the two real remote URL shapes GitHub
// actually issues: HTTPS (what this repo's own origin uses, confirmed
// via a real `git remote get-url origin` during this round's own Phase
// 0) and SSH (git@github.com:owner/repo.git), plus the less common but
// valid ssh:// long form.
export interface GitHubRemote {
  owner: string;
  repo: string;
}

const HTTPS_PATTERN = /^https:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const SSH_SHORT_PATTERN = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const SSH_URL_PATTERN = /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

export function parseGitHubRemoteUrl(url: string): GitHubRemote | null {
  const trimmed = url.trim();
  const match = HTTPS_PATTERN.exec(trimmed) ?? SSH_SHORT_PATTERN.exec(trimmed) ?? SSH_URL_PATTERN.exec(trimmed);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
