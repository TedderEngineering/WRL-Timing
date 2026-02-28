import { env } from "../config/env.js";

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send an email via Resend API.
 * In development without a key, logs to console instead.
 */
async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") {
      console.error("⚠️ RESEND_API_KEY not set — email not sent. Set it in Railway environment variables.");
    }
    console.log("─── Email (not sent — no API key) ──────────");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${html}`);
    console.log("────────────────────────────────────────────");
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Failed to send email to ${to}:`, body);
    throw new Error(`Email send failed: ${response.status}`);
  }
}

export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Verify your email — RaceTrace",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4263eb;">RaceTrace</h2>
        <p>Thanks for signing up! Please verify your email address by clicking the button below.</p>
        <a href="${verifyUrl}"
           style="display: inline-block; background: #4263eb; color: white; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; margin: 16px 0;">
          Verify Email
        </a>
        <p style="color: #666; font-size: 14px;">
          Or copy this link: <a href="${verifyUrl}">${verifyUrl}</a>
        </p>
        <p style="color: #999; font-size: 12px;">This link expires in 24 hours.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Reset your password — RaceTrace",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #4263eb;">RaceTrace</h2>
        <p>We received a request to reset your password. Click the button below to choose a new one.</p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #4263eb; color: white; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #666; font-size: 14px;">
          Or copy this link: <a href="${resetUrl}">${resetUrl}</a>
        </p>
        <p style="color: #999; font-size: 12px;">
          This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}
