// ── Input Sanitization for LLM Prompts ──────────────────────────────
// Prevents prompt injection by stripping control characters and
// limiting length of user-supplied data before it enters system prompts.

/**
 * Sanitize a string before injecting into an LLM prompt.
 * Strips newlines, code blocks, XML-like tags, and limits length.
 */
export function sanitizeForPrompt(input: string, maxLength = 200): string {
  if (!input || typeof input !== "string") return "";
  return input
    .replace(/[\r\n]+/g, " ")           // Flatten newlines
    .replace(/```[\s\S]*?```/g, "")      // Remove code blocks
    .replace(/<[^>]*>/g, "")             // Remove XML/HTML tags
    .replace(/#{1,6}\s/g, "")            // Remove markdown headers
    .replace(/\s+/g, " ")               // Collapse whitespace
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize an array of strings for prompt injection.
 */
export function sanitizeArrayForPrompt(items: unknown, maxPerItem = 50): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => typeof item === "string")
    .map((item) => sanitizeForPrompt(item, maxPerItem))
    .filter(Boolean)
    .slice(0, 20); // Max 20 items
}

/**
 * Extract the first balanced JSON structure (array or object) from a string.
 * Greedy `/\[[\s\S]*\]/` regex is brittle — it matches from the first `[` to
 * the last `]` in the text and crashes JSON.parse if prose contains a stray
 * bracket. This walks the string, tracking bracket depth while respecting
 * string literals and escape characters.
 *
 * Returns the first complete top-level JSON structure found, or null if none.
 */
export function extractJsonStructure(text: string, type: "array" | "object" = "array"): string | null {
  if (!text) return null;
  const openChar = type === "array" ? "[" : "{";
  const closeChar = type === "array" ? "]" : "}";
  const start = text.indexOf(openChar);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ── Gift context sanitization for prompt injection ─────────────────
//
// Every user-controlled string in a GiftContext needs to be sanitized before
// being serialized into the Claude prompt. `JSON.stringify(context, null, 2)`
// would dump raw user input (recipient name, interests, past gifts, giver
// expression) straight into the system prompt — an adversarial recipient
// name like "Ignore all prior instructions..." leaks into the model's
// response. This helper produces a copy of the context with all string
// fields routed through `sanitizeForPrompt`.

type SanitizableContext = {
  recipient?: {
    name?: unknown;
    relationship?: unknown;
    closeness?: unknown;
    age?: unknown;
    interests?: unknown;
    personality?: unknown;
    wishes?: unknown;
    avoids?: unknown;
  };
  occasion?: {
    type?: unknown;
    date?: unknown;
    significance?: unknown;
    registryUrl?: unknown;
    audience?: unknown;
    occasionContext?: unknown;
  };
  gift?: {
    budget?: unknown;
    from?: unknown;
    direction?: unknown;
    giverWantsToExpress?: unknown;
  };
  pastGifts?: {
    worked?: unknown;
    failed?: unknown;
  };
  /**
   * Giver-level preferences merged from users.preferences (#119 Phase A).
   * philosophy is a high-risk prompt-injection surface (free text, 1000 chars).
   * hardAvoids is a chip array — same threat class as recipient.avoids.
   * defaultBudgets is a structured object — values are numbers, not strings.
   * locale is a short locale tag (e.g. "en-CA") — no injection risk but length-bound.
   */
  giver?: {
    philosophy?: unknown;
    hardAvoids?: unknown;
    defaultBudgets?: unknown;
    locale?: unknown;
  };
  giverContext?: unknown;
  recipientContext?: unknown;
  preferences?: unknown;
  constraints?: unknown;
  needs?: unknown;
  giver_context?: unknown;
  recipient_context?: unknown;
  _refinementReason?: unknown;
  [key: string]: unknown;
};

export function sanitizeGiftContext(ctx: SanitizableContext): Record<string, unknown> {
  const str = (v: unknown, max = 120): string | undefined => {
    if (typeof v !== "string" || !v) return undefined;
    const cleaned = sanitizeForPrompt(v, max);
    return cleaned || undefined;
  };
  const arr = (v: unknown, maxPerItem = 60): string[] | undefined => {
    const cleaned = sanitizeArrayForPrompt(v, maxPerItem);
    return cleaned.length > 0 ? cleaned : undefined;
  };
  const out: Record<string, unknown> = {};

  if (ctx.recipient) {
    const recipient: Record<string, unknown> = {};
    const name = str(ctx.recipient.name, 80);
    if (name) recipient.name = name;
    const relationship = str(ctx.recipient.relationship, 40);
    if (relationship) recipient.relationship = relationship;
    const closeness = str(ctx.recipient.closeness, 40);
    if (closeness) recipient.closeness = closeness;
    if (typeof ctx.recipient.age === "number" && Number.isFinite(ctx.recipient.age)) {
      recipient.age = Math.max(0, Math.min(150, Math.floor(ctx.recipient.age)));
    }
    const interests = arr(ctx.recipient.interests, 40);
    if (interests) recipient.interests = interests;
    const wishes = arr(ctx.recipient.wishes, 60);
    if (wishes) recipient.wishes = wishes;
    const avoids = arr(ctx.recipient.avoids, 60);
    if (avoids) recipient.avoids = avoids;
    if (Object.keys(recipient).length > 0) out.recipient = recipient;
  }

  if (ctx.occasion) {
    const occasion: Record<string, unknown> = {};
    const type = str(ctx.occasion.type, 40);
    if (type) occasion.type = type;
    const date = str(ctx.occasion.date, 40);
    if (date) occasion.date = date;
    const significance = str(ctx.occasion.significance, 200);
    if (significance) occasion.significance = significance;
    // Registry URL — validate shape (http/https only, length bound)
    const registryUrl = str(ctx.occasion.registryUrl, 500);
    if (registryUrl && /^https?:\/\//i.test(registryUrl)) {
      occasion.registryUrl = registryUrl;
    }
    const audience = str(ctx.occasion.audience, 40);
    if (audience) occasion.audience = audience;
    // occasionContext is an open object — sanitize each string value but
    // preserve structure so the agent can store occasion-specific signals.
    if (ctx.occasion.occasionContext && typeof ctx.occasion.occasionContext === "object") {
      const src = ctx.occasion.occasionContext as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      for (const k of Object.keys(src).slice(0, 20)) {
        const safeKey = k.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40);
        if (!safeKey) continue;
        const v = src[k];
        if (typeof v === "string") {
          const cv = str(v, 200);
          if (cv) cleaned[safeKey] = cv;
        } else if (typeof v === "number" || typeof v === "boolean") {
          cleaned[safeKey] = v;
        } else if (Array.isArray(v)) {
          const ca = arr(v, 80);
          if (ca) cleaned[safeKey] = ca;
        }
      }
      if (Object.keys(cleaned).length > 0) occasion.occasionContext = cleaned;
    }
    if (Object.keys(occasion).length > 0) out.occasion = occasion;
  }

  if (ctx.gift) {
    const gift: Record<string, unknown> = {};
    const budget = str(ctx.gift.budget, 40);
    if (budget) gift.budget = budget;
    const from = str(ctx.gift.from, 60);
    if (from) gift.from = from;
    const direction = str(ctx.gift.direction, 200);
    if (direction) gift.direction = direction;
    const giverWantsToExpress = str(ctx.gift.giverWantsToExpress, 200);
    if (giverWantsToExpress) gift.giverWantsToExpress = giverWantsToExpress;
    if (Object.keys(gift).length > 0) out.gift = gift;
  }

  if (ctx.pastGifts) {
    const pg: Record<string, unknown> = {};
    const worked = arr(ctx.pastGifts.worked, 80);
    if (worked) pg.worked = worked;
    const failed = arr(ctx.pastGifts.failed, 80);
    if (failed) pg.failed = failed;
    if (Object.keys(pg).length > 0) out.pastGifts = pg;
  }

  // Giver slot — merged from users.preferences by /api/recommend/route.ts
  // philosophy: free-text, 1000-char cap (per orchestrator override), same
  //   injection treatment as gift.giverWantsToExpress.
  // hardAvoids: chip array — same treatment as recipient.avoids.
  // defaultBudgets: structured object of { min, max } pairs keyed by occasion
  //   type. Values are numbers — pass through with key allowlist and numeric guard.
  // locale: short tag, length-bounded.
  if (ctx.giver) {
    const giver: Record<string, unknown> = {};
    const philosophy = str(ctx.giver.philosophy, 1000);
    if (philosophy) giver.philosophy = philosophy;
    const hardAvoids = arr(ctx.giver.hardAvoids, 60);
    if (hardAvoids) giver.hardAvoids = hardAvoids;
    const locale = str(ctx.giver.locale, 20);
    if (locale) giver.locale = locale;
    // defaultBudgets: allow only expected occasion-type keys; values must be
    // objects with numeric min/max. Never pass arbitrary keys into the prompt.
    const ALLOWED_OCCASION_KEYS = new Set([
      "birthday", "wedding", "anniversary", "housewarming",
      "mothers_day", "fathers_day", "graduation", "holiday", "just_because",
    ]);
    if (ctx.giver.defaultBudgets && typeof ctx.giver.defaultBudgets === "object" && !Array.isArray(ctx.giver.defaultBudgets)) {
      const raw = ctx.giver.defaultBudgets as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      for (const k of Object.keys(raw)) {
        if (!ALLOWED_OCCASION_KEYS.has(k)) continue;
        const v = raw[k];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const pair = v as Record<string, unknown>;
          const min = typeof pair.min === "number" && Number.isFinite(pair.min) ? Math.round(pair.min) : null;
          const max = typeof pair.max === "number" && Number.isFinite(pair.max) ? Math.round(pair.max) : null;
          if (min !== null && max !== null && min >= 0 && max >= min) {
            cleaned[k] = { min, max };
          }
        }
      }
      if (Object.keys(cleaned).length > 0) giver.defaultBudgets = cleaned;
    }
    if (Object.keys(giver).length > 0) out.giver = giver;
  }

  // Host-passed AI memory/context (#135). These can be verbose but still need
  // prompt-injection cleanup and hard caps before they enter the recommender.
  const giverContext = str(ctx.giverContext, 2000);
  if (giverContext) out.giverContext = giverContext;
  const recipientContext = str(ctx.recipientContext, 2000);
  if (recipientContext) out.recipientContext = recipientContext;

  const preferences = str(ctx.preferences, 300);
  if (preferences) out.preferences = preferences;
  const constraints = str(ctx.constraints, 300);
  if (constraints) out.constraints = constraints;
  const needs = str(ctx.needs, 300);
  if (needs) out.needs = needs;
  const snakeGiverContext = str(ctx.giver_context, 500);
  if (snakeGiverContext) out.giver_context = snakeGiverContext;
  const snakeRecipientContext = str(ctx.recipient_context, 500);
  if (snakeRecipientContext) out.recipient_context = snakeRecipientContext;

  const refinement = str(ctx._refinementReason, 200);
  if (refinement) out._refinementReason = refinement;

  return out;
}

/**
 * Coerce user input for recipient.interests into a clean string array.
 * Accepts: string[] (preferred), string (comma-separated), or null/undefined.
 * Drops non-string values silently. Never throws.
 */
export function coerceInterests(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((i): i is string => typeof i === "string" && i.length > 0);
  }
  if (typeof raw === "string") {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Strip error details for production responses.
 * Only includes the generic message, never the stack trace.
 */
export function safeErrorMessage(error: unknown): string {
  if (process.env.NODE_ENV === "development") {
    return String(error);
  }
  return "An internal error occurred";
}
