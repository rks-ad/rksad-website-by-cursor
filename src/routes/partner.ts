import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { storeOtp, getOtp, deleteOtp } from "../otp-store.js";
import { sendEmail, EmailSendError } from "../resend.js";
import { buildOtpEmailHtml, buildPartnerNotifyEmailHtml } from "../emails.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function partnerNotifyTo(): string {
  return (process.env.PARTNER_NOTIFY_EMAIL || "iam@rks.ad").trim();
}

function jsonError(c: Context, status: ContentfulStatusCode, message: string) {
  return c.json({ success: false, message }, status);
}

export async function sendOtp(c: Context) {
  try {
    const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
    const email = body.email?.trim().toLowerCase();

    if (!email) return jsonError(c, 400, "Email required");
    if (!EMAIL_RE.test(email)) return jsonError(c, 400, "Please enter a valid email address");

    const otp = generateOtp();
    await storeOtp(email, otp);

    await sendEmail({
      to: email,
      subject: "Your OTP for Partnering with RKS.Ad",
      html: buildOtpEmailHtml(otp),
      replyTo: partnerNotifyTo(),
    });

    return c.json({ success: true, message: "OTP sent successfully" }, 200);
  } catch (err) {
    console.error("[send-otp]", err);
    if (err instanceof EmailSendError) {
      return jsonError(c, 500, err.message);
    }
    return jsonError(
      c,
      500,
      err instanceof Error ? err.message : "Error sending OTP"
    );
  }
}

export async function verifyOtp(c: Context) {
  try {
    const body = await c.req
      .json<{ email?: string; otp?: string }>()
      .catch(() => ({} as { email?: string; otp?: string }));
    const email = body.email?.trim().toLowerCase();
    const otp = body.otp?.trim();

    if (!email || !otp) {
      return jsonError(c, 400, "Email and OTP required");
    }
    if (!/^\d{6}$/.test(otp)) {
      return jsonError(c, 400, "Enter the 6-digit OTP from your email");
    }

    const storedOtp = await getOtp(email);

    if (!storedOtp) {
      return jsonError(c, 400, "OTP expired or not found. Please request a new one.");
    }

    if (storedOtp !== otp) {
      return jsonError(c, 400, "Invalid OTP. Please check and try again.");
    }

    await deleteOtp(email);
    return c.json({ success: true }, 200);
  } catch (err) {
    console.error("[verify-otp]", err);
    return jsonError(c, 500, "Verification failed. Please try again.");
  }
}

export async function submitPartner(c: Context) {
  try {
    const data = await c.req
      .json<{
        email?: string;
        name?: string;
        mobile?: string;
        city?: string;
        expertise?: string;
        enrollment?: string;
      }>()
      .catch(() => ({} as Record<string, string | undefined>));

    const email = data.email?.trim().toLowerCase() || "";
    const name = data.name?.trim() || "";
    const mobile = data.mobile?.trim() || "";
    const city = data.city?.trim();
    const expertise = data.expertise?.trim();
    const enrollment = data.enrollment?.trim();

    if (!email || !name || !mobile) {
      return jsonError(c, 400, "Name, Email and Mobile are required");
    }
    if (!EMAIL_RE.test(email)) {
      return jsonError(c, 400, "Please enter a valid email address");
    }
    if (!/^\d{10}$/.test(mobile)) {
      return jsonError(c, 400, "Please enter a valid 10-digit mobile number");
    }

    const notifyTo = partnerNotifyTo();

    await sendEmail({
      to: notifyTo,
      subject: `New Partnership Request — ${name} | RKS.Ad`,
      html: buildPartnerNotifyEmailHtml({
        email,
        name,
        mobile,
        city,
        expertise,
        enrollment,
      }),
      replyTo: email,
    });

    return c.json({ success: true, message: "Submitted successfully" }, 200);
  } catch (err) {
    console.error("[submit-partner]", err);
    if (err instanceof EmailSendError) {
      return jsonError(c, 500, err.message);
    }
    return jsonError(c, 500, "Submission failed. Please try again.");
  }
}
