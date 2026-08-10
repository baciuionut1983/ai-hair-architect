function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface VerificationEmailHtmlInput {
  introText: string;
  verifyUrl: string;
  expiryNote: string;
}

/**
 * Plain template literal, no template engine -- the only untrusted-shaped
 * value here is verifyUrl (built from a server-controlled base URL plus a
 * hex-only crypto token, but escaped anyway as defense-in-depth), and every
 * interpolated value is passed through escapeHtml so nothing here can ever
 * inject markup into the rendered email.
 */
export function buildVerificationEmailHtml(input: VerificationEmailHtmlInput): string {
  const safeIntro = escapeHtml(input.introText);
  const safeUrl = escapeHtml(input.verifyUrl);
  const safeExpiry = escapeHtml(input.expiryNote);

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td style="font-size:20px;font-weight:bold;color:#111827;padding-bottom:16px;">AI Hair Architect</td>
            </tr>
            <tr>
              <td style="font-size:14px;color:#374151;line-height:1.5;padding-bottom:24px;">${safeIntro}</td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${safeUrl}" style="background-color:#111827;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;display:inline-block;">Verify email</a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#6b7280;line-height:1.5;padding-bottom:8px;">${safeExpiry}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#9ca3af;word-break:break-all;">${safeUrl}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
