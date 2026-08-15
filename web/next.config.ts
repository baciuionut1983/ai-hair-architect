import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
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
