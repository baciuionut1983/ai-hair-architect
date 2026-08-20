import { execSync } from "child_process";

import type { NextConfig } from "next";

import { resolveBuildCommitSha } from "./src/lib/resolve-build-commit-sha";

// Stale-client-bundle diagnosis (2026-08-20, Round 9): a real production
// test showed 5 TTS timing fields (introduced in the immediately prior
// deploy) still reading as null, while an OLDER field (ttsProviderMs,
// introduced two deploys earlier) worked correctly -- traced by code to
// the exact old vs. new onSuccess callback signatures, and the only
// coherent explanation covering every symptom at once (including the
// 16kHz STT downsampling appearing to have zero effect) is that the
// browser tab ran a JS bundle built before these changes shipped, never
// reloaded since. This build-time git SHA is embedded into the client
// bundle (NEXT_PUBLIC_* vars are statically inlined at build time) so
// the VOICE_LATENCY_SUMMARY log line can directly answer "was this
// browser actually running the code we think it was" on the next real
// test, instead of presuming again.
//
// Round 10 fix: the very first real production report of clientBuildSha
// came back "unknown" despite Railway building and deploying the exact
// right commit -- see resolve-build-commit-sha.ts's own doc comment for
// the root cause (Railway's containerized build environment doesn't
// guarantee `git rev-parse` works) and the fix (prefer Railway's own
// RAILWAY_GIT_COMMIT_SHA, which IS available during the build step per
// Railway's own docs, falling back to git rev-parse for local dev builds
// where that variable is never set).
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_COMMIT_SHA: resolveBuildCommitSha({ env: process.env, execSync }),
  },
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          // microphone=(self): the "Speak to AI" voice-note feature
          // (teach-ai-panel.tsx) calls getUserMedia({ audio: true }) from
          // this app's own pages. A blanket microphone=() blocked that
          // call with a Permissions-Policy violation before the browser
          // ever consulted the user's own site/OS microphone permission --
          // camera and geolocation stay fully disabled since nothing in
          // this app uses them.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          {
            key: "Content-Security-Policy",
            // media-src 'self' blob: -- required for cloud Voice Reply
            // (consultation-chat.tsx's <audio> element playing a blob:
            // URL built from the /voice-reply response). Without an
            // explicit media-src, CSP falls back to default-src 'self',
            // which does NOT include the blob: scheme -- Chrome then
            // blocks the <audio> element's src at the security-policy
            // level, before ever attempting to decode it, surfacing as
            // "MEDIA_ELEMENT_ERROR: Media rejected by URL safety check"
            // + the play() promise rejecting with NotSupportedError
            // ("no supported source was found") -- both symptoms of the
            // load being blocked, not of a malformed audio file. Same
            // reasoning img-src 'self' data: blob: already applies to
            // (client photo previews, also built via
            // URL.createObjectURL) -- media-src needs the identical
            // blob: allowance for the same reason, now that audio blobs
            // exist too. Applies globally (source: "/:path*" below), so
            // this fixes every language's Voice Reply, not just one.
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
          },
          {
            key: "Strict-Transport-Security",
            value: process.env.NODE_ENV === "production" ? "max-age=31536000; includeSubDomains; preload" : "max-age=0"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
