/**
 * Thin Resend API wrapper with clearer errors for OTP / partner flows.
 */

import {
  getResendApiKey,
  isPlaceholderResendKey,
  envString,
} from "./env.js";

export class EmailSendError extends Error {
  status: number;
  details: string;

  constructor(message: string, status = 500, details = "") {
    super(message);
    this.name = "EmailSendError";
    this.status = status;
    this.details = details;
  }
}

export async function sendEmail(options: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<void> {
  const apiKey = getResendApiKey();

  if (!apiKey) {
    // Help operators see which related env names exist (without leaking values)
    const related = Object.keys(process.env)
      .filter((k) => /resend/i.test(k))
      .sort();
    console.error("[email] RESEND_API_KEY missing at runtime. Related env names:", related);
    throw new EmailSendError(
      "Email is not configured (RESEND_API_KEY missing in the running container). " +
        "In Dokploy/Coolify set RESEND_API_KEY on this service as a runtime environment variable, then Redeploy. " +
        "Check /health → resendKeyPresent.",
      500
    );
  }

  if (isPlaceholderResendKey(apiKey)) {
    throw new EmailSendError(
      "RESEND_API_KEY looks like a placeholder. Paste your real Resend key (starts with re_).",
      500
    );
  }

  const fromEmail = envString("FROM_EMAIL") || "Notify@mails.rks.ad";
  const fromName = envString("FROM_NAME") || "RKS.Ad Notify";
  const replyTo =
    options.replyTo ||
    envString("PARTNER_NOTIFY_EMAIL") ||
    "iam@rks.ad";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: options.to,
      reply_to: replyTo,
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = `Failed to send email (Resend ${res.status})`;

    try {
      const parsed = JSON.parse(body) as { message?: string; name?: string };
      if (parsed.message) message = parsed.message;
    } catch {
      if (body) message = body.slice(0, 240);
    }

    if (res.status === 401) {
      message =
        "Resend rejected the API key (401). Double-check RESEND_API_KEY in Dokploy/Coolify (no extra spaces/quotes).";
    }

    if (res.status === 403 || /domain|verified|not allowed/i.test(message)) {
      message =
        `${message} — verify that FROM_EMAIL (${fromEmail}) uses a domain verified in Resend.`;
    }

    throw new EmailSendError(message, res.status >= 400 && res.status < 600 ? res.status : 500, body);
  }
}
