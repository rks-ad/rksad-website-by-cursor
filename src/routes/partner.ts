import type { Context } from "hono";
import { storeOtp, getOtp, deleteOtp } from "../otp-store.js";
import { sendEmail } from "../resend.js";

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOtp(c: Context) {
  try {
    const body = await c.req.json<{ email?: string }>();
    const email = body.email?.trim();
    if (!email) return c.text("Email required", 400);

    const otp = generateOtp();
    await storeOtp(email, otp);

    await sendEmail({
      to: email,
      subject: "Your OTP for Partnering with RKS.Ad",
      html:
        '<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;"><h2 style="color: #111;">Hello,</h2><p>Thank you for your interest in partnering with <strong>RKS.Ad</strong>.</p><p>Your One-Time Password (OTP) is:</p><div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; background: #f4f4f5; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0;">' +
        otp +
        '</div><p>This OTP is valid for <strong>10 minutes</strong>.</p><p style="color: #666; font-size: 14px;">If you did not request this, please ignore this email.</p><br><p>Best regards,<br><strong>Ravi Kumar Sharma</strong><br>Advocate | RKS.Ad</p></div>',
    });

    return c.json({ success: true }, 200);
  } catch (err) {
    console.error("[send-otp]", err);
    return c.text("Error sending OTP", 500);
  }
}

export async function verifyOtp(c: Context) {
  try {
    const body = await c.req.json<{ email?: string; otp?: string }>();
    const email = body.email?.trim();
    const otp = body.otp?.trim();

    if (!email || !otp) return c.text("Email and OTP required", 400);

    const storedOtp = await getOtp(email);

    if (!storedOtp) {
      return c.json(
        { success: false, message: "OTP expired or not found" },
        400
      );
    }

    if (storedOtp !== otp) {
      return c.json({ success: false, message: "Invalid OTP" }, 400);
    }

    await deleteOtp(email);
    return c.json({ success: true }, 200);
  } catch (err) {
    console.error("[verify-otp]", err);
    return c.text("Verification failed", 500);
  }
}

export async function submitPartner(c: Context) {
  try {
    const data = await c.req.json<{
      email?: string;
      name?: string;
      mobile?: string;
      city?: string;
      expertise?: string;
      enrollment?: string;
    }>();

    const { email, name, mobile, city, expertise, enrollment } = data;

    if (!email || !name || !mobile) {
      return c.text("Name, Email and Mobile are required", 400);
    }

    await sendEmail({
      to: "iam@rks.ad",
      subject: "New Partnership Request - RKS.Ad",
      html: `
                            <h3>New Partnership Interest Received</h3>
                            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
                            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
                            <p><strong>Mobile:</strong> ${escapeHtml(mobile)}</p>
                            <p><strong>City:</strong> ${escapeHtml(city || "Not provided")}</p>
                            <p><strong>Expertise Area:</strong> ${escapeHtml(expertise || "Not provided")}</p>
                            <p><strong>Enrollment / COP Number:</strong> ${escapeHtml(enrollment || "Not provided")}</p>
                        `,
    });

    return c.json({ success: true }, 200);
  } catch (err) {
    console.error("[submit-partner]", err);
    return c.text("Submission failed", 500);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
