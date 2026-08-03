/**
 * Professional branded email templates for RKS.Ad
 */

const LOGO_URL =
  process.env.EMAIL_LOGO_URL ||
  "https://pub-1ed86eb4d93c4a50befdc06c2eb497c1.r2.dev/rks-adlogo%2Bfinal_comp.gif";

const SITE_URL = (process.env.SITE_URL || "https://rks.ad").replace(/\/$/, "");
const CONTACT_EMAIL = process.env.PARTNER_NOTIFY_EMAIL || "iam@rks.ad";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailShell(options: {
  preheader: string;
  title: string;
  bodyHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:#0b0b12;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b12;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="background:linear-gradient(135deg,#0a0a0a 0%,#12122a 100%);padding:28px 24px;text-align:center;">
              <img src="${LOGO_URL}" alt="RKS.Ad" width="160" style="max-width:160px;height:auto;display:inline-block;border:0;" />
              <div style="margin-top:14px;color:#67e8f9;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Ravi Kumar Sharma · Advocate</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px 28px;color:#18181b;font-size:15px;line-height:1.65;">
              ${options.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;border-radius:12px;">
                <tr>
                  <td style="padding:18px 20px;font-size:13px;line-height:1.6;color:#3f3f46;">
                    <strong style="color:#18181b;font-size:14px;">Ravi Kumar Sharma</strong><br />
                    Advocate | RKS.Ad<br />
                    Jaipur, Rajasthan, India<br />
                    <a href="mailto:${CONTACT_EMAIL}" style="color:#0891b2;text-decoration:none;">${CONTACT_EMAIL}</a>
                    &nbsp;·&nbsp;
                    <a href="${SITE_URL}/" style="color:#0891b2;text-decoration:none;">${SITE_URL.replace("https://", "")}</a><br />
                    <span style="color:#71717a;">Civil · Criminal · Family · Corporate · Tribunals</span>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:11px;line-height:1.5;color:#a1a1aa;text-align:center;">
                This email was sent by RKS.Ad. If you did not expect it, you can safely ignore this message.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildOtpEmailHtml(otp: string): string {
  const safeOtp = escapeHtml(otp);
  return emailShell({
    preheader: `Your RKS.Ad partnership OTP is ${otp}. Valid for 10 minutes.`,
    title: "Your OTP for Partnering with RKS.Ad",
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#09090b;">Partnership verification</h1>
      <p style="margin:0 0 14px;">Hello,</p>
      <p style="margin:0 0 14px;">
        Thank you for your interest in partnering with <strong>RKS.Ad</strong>.
        Please use the one-time password below to continue your partnership request.
      </p>
      <div style="margin:22px 0;padding:18px 16px;border-radius:12px;background:#ecfeff;border:1px solid #a5f3fc;text-align:center;">
        <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#0e7490;margin-bottom:8px;">One-Time Password</div>
        <div style="font-size:34px;font-weight:700;letter-spacing:10px;color:#0f172a;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${safeOtp}</div>
      </div>
      <p style="margin:0 0 14px;">This OTP is valid for <strong>10 minutes</strong>.</p>
      <p style="margin:0 0 14px;color:#52525b;font-size:14px;">
        If you did not request this, please ignore this email. No further action is required.
      </p>
      <p style="margin:0;">
        Warm regards,<br />
        <strong>Ravi Kumar Sharma</strong><br />
        Advocate | RKS.Ad
      </p>
    `,
  });
}

export function buildPartnerNotifyEmailHtml(data: {
  email: string;
  name: string;
  mobile: string;
  city?: string;
  expertise?: string;
  enrollment?: string;
}): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;width:40%;color:#52525b;font-size:13px;">${escapeHtml(label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e4e4e7;color:#18181b;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
    </tr>`;

  return emailShell({
    preheader: `New partnership request from ${data.name} (${data.email})`,
    title: "New Partnership Request — RKS.Ad",
    bodyHtml: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#09090b;">New partnership interest</h1>
      <p style="margin:0 0 18px;">
        A verified applicant submitted the partner form on
        <a href="${SITE_URL}/" style="color:#0891b2;text-decoration:none;">${SITE_URL.replace("https://", "")}</a>.
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
        ${row("Name", data.name)}
        ${row("Email", data.email)}
        ${row("Mobile", data.mobile)}
        ${row("City", data.city || "Not provided")}
        ${row("Expertise Area", data.expertise || "Not provided")}
        ${row("Enrollment / COP", data.enrollment || "Not provided")}
      </table>
      <p style="margin:18px 0 0;">
        <a href="mailto:${escapeHtml(data.email)}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;font-size:14px;">
          Reply to applicant
        </a>
      </p>
    `,
  });
}
