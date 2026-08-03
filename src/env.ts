/**
 * Central env helpers — resilient to Dokploy/Coolify quoting / naming quirks.
 */

import { readFileSync, existsSync } from "node:fs";

function stripQuotes(value: string): string {
  let v = value.trim();
  // Handle accidental full-line pastes like: RESEND_API_KEY=re_xxx  or RESEND_API_KEY:re_xxx
  const lineMatch = v.match(
    /^(?:export\s+)?(?:RESEND_API_KEY|RESEND_KEY|RESEND_TOKEN|RESEND_API_TOKEN)\s*[=:]\s*(.+)$/i
  );
  if (lineMatch?.[1]) v = lineMatch[1].trim();

  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1).trim();
  }
  return v;
}

function normalizeEnvName(name: string): string {
  return name.replace(/[^\w]/g, "").toLowerCase();
}

/** Find an env var by exact or fuzzy/case-insensitive name. */
function findEnvRaw(...names: string[]): string {
  for (const name of names) {
    const exact = process.env[name];
    if (typeof exact === "string" && exact.trim() !== "") return exact;
  }

  const wanted = names.map(normalizeEnvName);
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (wanted.includes(normalizeEnvName(key))) return value;
  }

  return "";
}

/** Read a process env var, stripping accidental quotes/whitespace. */
export function envString(...names: string[]): string {
  const raw = findEnvRaw(...names);
  return raw ? stripQuotes(raw) : "";
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

  // Last resort: any env value that looks like a Resend key
  if (!key) {
    for (const [name, value] of Object.entries(process.env)) {
      if (typeof value !== "string") continue;
      const cleaned = stripQuotes(value);
      if (/^re_[A-Za-z0-9_]{10,}$/.test(cleaned) && /resend|mail|api/i.test(name)) {
        key = cleaned;
        console.warn(`[env] Using Resend-like value from env var "${name}"`);
        break;
      }
    }
  }

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

export function listRelatedEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((k) => /resend|from_email|from_name|partner_notify|mail/i.test(k))
    .sort();
}

export function getEmailConfigStatus(): {
  emailConfigured: boolean;
  resendKeyPresent: boolean;
  resendKeyMasked: string;
  resendKeyLooksValid: boolean;
  fromEmail: string;
  partnerNotifyEmail: string;
  resendEnvNamesFound: string[];
  relatedEnvNames: string[];
  hint: string;
} {
  const key = getResendApiKey();
  const foundNames = [
    "RESEND_API_KEY",
    "RESEND_KEY",
    "RESEND_TOKEN",
    "RESEND_API_TOKEN",
  ].filter((n) => typeof process.env[n] === "string" && process.env[n]!.length > 0);

  const relatedEnvNames = listRelatedEnvNames();
  const present = Boolean(key);
  const looksValid =
    present && !isPlaceholderResendKey(key) && /^re_[A-Za-z0-9_]+$/.test(key);

  let hint = "ok";
  if (!present) {
    hint =
      "RESEND_API_KEY is not in the running container. In Dokploy/Coolify use Key=RESEND_API_KEY and Value=re_... (use = not : in .env files), then Redeploy.";
  } else if (!looksValid) {
    hint =
      "RESEND_API_KEY is present but does not look like a valid Resend key (should start with re_).";
  }

  return {
    emailConfigured: looksValid,
    resendKeyPresent: present,
    resendKeyMasked: maskSecret(key),
    resendKeyLooksValid: looksValid,
    fromEmail: envString("FROM_EMAIL") || "Notify@mails.rks.ad",
    partnerNotifyEmail: envString("PARTNER_NOTIFY_EMAIL") || "iam@rks.ad",
    resendEnvNamesFound: foundNames,
    relatedEnvNames,
    hint,
  };
}

export function logEmailConfigAtStartup(): void {
  const status = getEmailConfigStatus();
  console.log("[rksad] email config:", {
    emailConfigured: status.emailConfigured,
    resendKeyPresent: status.resendKeyPresent,
    resendKeyMasked: status.resendKeyMasked,
    resendEnvNamesFound: status.resendEnvNamesFound,
    relatedEnvNames: status.relatedEnvNames,
    fromEmail: status.fromEmail,
    partnerNotifyEmail: status.partnerNotifyEmail,
    hint: status.hint,
  });

  if (!status.resendKeyPresent) {
    console.warn(
      "[rksad] WARNING: RESEND_API_KEY is not visible to this process.\n" +
        "  Fix in Dokploy/Coolify:\n" +
        "  1) Environment variable NAME must be exactly: RESEND_API_KEY\n" +
        "  2) VALUE must be only the key: re_xxxxx  (do NOT write RESEND_API_KEY:re_xxx as the value)\n" +
        "  3) In .env files use EQUALS: RESEND_API_KEY=re_xxxxx   (colon : will NOT work)\n" +
        "  4) Save + Redeploy/Restart the service\n" +
        "  5) Check /health → resendKeyPresent should be true"
    );
  } else if (!status.emailConfigured) {
    console.warn(
      "[rksad] WARNING: RESEND_API_KEY is present but looks invalid:",
      status.resendKeyMasked
    );
  }
}
