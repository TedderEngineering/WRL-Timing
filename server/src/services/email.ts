import { env } from "../config/env.js";
import { racetraceSite, type Site } from "./site.js";

interface SendEmailParams {
  /** Display name for the sender; the address always comes from EMAIL_FROM. */
  fromName?: string;
  to: string;
  subject: string;
  html: string;
}

/**
 * Send an email via Resend API.
 * In development without a key, logs to console instead.
 */
/** "Finding Grip <noreply@example.com>" from EMAIL_FROM's address and a display name. */
export function senderFor(emailFrom: string, fromName?: string): string {
  if (!fromName) return emailFrom;
  const address = /<([^>]+)>/.exec(emailFrom)?.[1] ?? emailFrom.trim();
  return `${fromName} <${address}>`;
}

async function sendEmail({
  fromName,
  to,
  subject,
  html,
}: SendEmailParams): Promise<void> {
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") {
      console.error(
        "⚠️ RESEND_API_KEY not set — email not sent. Set it in Railway environment variables."
      );
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
      from: senderFor(env.EMAIL_FROM, fromName),
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
  token: string,
  site: Site = racetraceSite()
): Promise<void> {
  const verifyUrl = `${site.url}/verify-email?token=${token}`;

  await sendEmail({
    // RaceTrace mail keeps the sender exactly as configured.
    fromName: site.key === "racetrace" ? undefined : site.name,
    to: email,
    subject: `Verify your email — ${site.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: ${site.accent};">${site.name}</h2>
        <p>Thanks for signing up! Please verify your email address by clicking the button below.</p>
        <a href="${verifyUrl}"
           style="display: inline-block; background: ${site.accent}; color: white; padding: 12px 24px;
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
  token: string,
  site: Site = racetraceSite()
): Promise<void> {
  const resetUrl = `${site.url}/reset-password?token=${token}`;

  await sendEmail({
    // RaceTrace mail keeps the sender exactly as configured.
    fromName: site.key === "racetrace" ? undefined : site.name,
    to: email,
    subject: `Reset your password — ${site.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: ${site.accent};">${site.name}</h2>
        <p>We received a request to reset your password. Click the button below to choose a new one.</p>
        <a href="${resetUrl}"
           style="display: inline-block; background: ${site.accent}; color: white; padding: 12px 24px;
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

/** Escape text that came from a person (team names, display names) for email HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

/**
 * Setup Sheet: tell someone they've been invited to a team.
 * `hasAccount` decides between "open Setup Sheet" and "create an account".
 */
export async function sendSetupInviteEmail(params: {
  to: string;
  teamName: string;
  inviterName: string;
  role: "OWNER" | "ENGINEER" | "VIEWER";
  hasAccount: boolean;
  site: Site;
}): Promise<void> {
  const { to, site } = params;
  const team = escapeHtml(params.teamName);
  const inviter = escapeHtml(params.inviterName);
  const roleText = { OWNER: "an owner", ENGINEER: "an engineer", VIEWER: "a viewer" }[params.role];
  const url = params.hasAccount ? site.url : `${site.url}/login?mode=signup&email=${encodeURIComponent(to)}`;
  const action = params.hasAccount ? "Open Setup Sheet" : "Create your account";
  const next = params.hasAccount
    ? "Sign in with this email address to accept or decline."
    : "Create an account with this email address and verify it, then accept the invite.";

  await sendEmail({
    fromName: site.name,
    to,
    subject: `${params.inviterName} invited you to ${params.teamName} — ${site.name}`.slice(0, 200),
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: ${site.accent};">${site.name}</h2>
        <p>${inviter} invited you to join <strong>${team}</strong> as ${roleText}.</p>
        <p>${next} The same login works for RaceTrace and Finding Grip.</p>
        <a href="${url}"
           style="display: inline-block; background: ${site.accent}; color: white; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; margin: 16px 0;">
          ${action}
        </a>
        <p style="color: #666; font-size: 14px;">
          Or copy this link: <a href="${url}">${url}</a>
        </p>
      </div>
    `,
  });
}
