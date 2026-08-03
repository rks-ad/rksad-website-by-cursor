/**
 * Thin Resend API wrapper with clearer errors for OTP / partner flows.
 */

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
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new EmailSendError(
      "Email is not configured (RESEND_API_KEY missing). Set it in Dokploy/Coolify.",
      500
    );
  }

  if (
    apiKey.includes("xxxx") ||
    apiKey === "re_xxxxxxxxxxxxxxxxxxxxxxxx"
  ) {
    throw new EmailSendError(
      "RESEND_API_KEY looks like a placeholder. Use your real Resend API key.",
      500
    );
  }

  const fromEmail = (process.env.FROM_EMAIL || "Notify@mails.rks.ad").trim();
  const fromName = (process.env.FROM_NAME || "RKS.Ad Notify").trim();
  const replyTo =
    options.replyTo ||
    process.env.PARTNER_NOTIFY_EMAIL ||
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

    // Common production misconfig: unverified sending domain
    if (res.status === 403 || /domain|verified|not allowed/i.test(message)) {
      message =
        `${message} — verify that FROM_EMAIL (${fromEmail}) uses a domain verified in Resend.`;
    }

    throw new EmailSendError(message, res.status >= 400 ? res.status : 500, body);
  }
}
