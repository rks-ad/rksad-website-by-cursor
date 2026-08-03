/**
 * Central env helpers — resilient to Dokploy/Coolify quoting / naming quirks.
 */

import { readFileSync, existsSync } from "node:fs";

function stripQuotes(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/** Read a process env var, stripping accidental quotes/whitespace. */
export function envString(...names: string[]): string {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === "string" && raw.trim() !== "") {
      return stripQuotes(raw);
    }
  }
  return "";
}

/**
 * Resolve Resend API key from common env names / secret files.
 * Dokploy/Coolify sometimes use slightly different names or wrap values in quotes.
 */
export function getResendApiKey(): string {
  let key = envString(
    "RESEND_API_KEY",
    "RESEND_KEY",
    "RESEND_TOKEN",
    "RESEND_API_TOKEN"
  );

  if (!key) {
    const secretPaths = [
      process.env.RESEND_API_KEY_FILE,
      "/run/secrets/resend_api_key",
      "/run/secrets/RESEND_API_KEY",
    ].filter(Boolean) as string[];

    for (const path of secretPaths) {
      try {
        if (existsSync(path)) {
          key = stripQuotes(readFileSync(path, "utf-8"));
          if (key) break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (key.toLowerCase().startsWith("bearer ")) {
    key = key.slice(7).trim();
  }

  return key;
}

export function isPlaceholderResendKey(key: string): boolean {
  const k = key.trim();
  if (!k) return true;
  if (k === "re_xxxxxxxxxxxxxxxxxxxxxxxx") return true;
  // Only treat obvious template placeholders as invalid — not real keys that happen to contain "x"
  if (/^re_x+$/i.test(k)) return true;
  if (/your[_-]?api[_-]?key/i.test(k)) return true;
  if (/changeme|replace_me|example/i.test(k)) return true;
  return false;
}

export function maskSecret(value: string): string {
  if (!value) return "(missing)";
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 5)}…${value.slice(-4)} (len=${value.length})`;
}

export function getEmailConfigStatus(): {
  emailConfigured: boolean;
  resendKeyPresent: boolean;
  resendKeyMasked: string;
  resendKeyLooksValid: boolean;
  fromEmail: string;
  partnerNotifyEmail: string;
  resendEnvNamesFound: string[];
} {
  const key = getResendApiKey();
  const foundNames = [
    "RESEND_API_KEY",
    "RESEND_KEY",
    "RESEND_TOKEN",
    "RESEND_API_TOKEN",
  ].filter((n) => typeof process.env[n] === "string" && process.env[n]!.length > 0);

  const present = Boolean(key);
  const looksValid = present && !isPlaceholderResendKey(key) && key.startsWith("re_");

  return {
    emailConfigured: looksValid,
    resendKeyPresent: present,
    resendKeyMasked: maskSecret(key),
    resendKeyLooksValid: looksValid,
    fromEmail: envString("FROM_EMAIL") || "Notify@mails.rks.ad",
    partnerNotifyEmail: envString("PARTNER_NOTIFY_EMAIL") || "iam@rks.ad",
    resendEnvNamesFound: foundNames,
  };
}

export function logEmailConfigAtStartup(): void {
  const status = getEmailConfigStatus();
  console.log("[rksad] email config:", {
    emailConfigured: status.emailConfigured,
    resendKeyPresent: status.resendKeyPresent,
    resendKeyMasked: status.resendKeyMasked,
    resendEnvNamesFound: status.resendEnvNamesFound,
    fromEmail: status.fromEmail,
    partnerNotifyEmail: status.partnerNotifyEmail,
  });

  if (!status.resendKeyPresent) {
    console.warn(
      "[rksad] WARNING: RESEND_API_KEY is not visible to this process. " +
        "In Dokploy/Coolify: add RESEND_API_KEY under the service Environment (runtime), then Redeploy/Restart."
    );
  } else if (!status.emailConfigured) {
    console.warn(
      "[rksad] WARNING: RESEND_API_KEY is present but looks invalid/placeholder:",
      status.resendKeyMasked
    );
  }
}
