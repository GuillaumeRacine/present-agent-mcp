import type { GiftContext } from "./types";
import type { AgentContextSummary } from "./agent-context";

export function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export function extractHardAvoids(constraints?: string | null): string[] {
  if (!constraints) return [];
  return constraints
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const normalized = item.toLowerCase();
      if (/\bnot\s+(?:allergic|sensitive|too expensive|expensive|a problem|an issue)\b/.test(normalized)) {
        return [];
      }
      const direct = item.match(/^(?:avoid|no|never|don't buy|do not buy)\s+(.+)$/i);
      if (direct?.[1]) return [direct[1].trim()];
      const allergy = item.match(/^(?:allergic|allergy|sensitive)\s+(?:to\s+)?(.+)$/i);
      if (allergy?.[1]) return [allergy[1].trim()];
      const dislike = item.match(/^(?:hates|dislikes)\s+(.+)$/i);
      if (dislike?.[1]) return [dislike[1].trim()];
      return [];
    })
    .filter(Boolean);
}

export function redactLocalAgentContextForPersistence(
  context: GiftContext,
  agentSummary: AgentContextSummary | null,
): GiftContext {
  const clone = JSON.parse(JSON.stringify(context)) as GiftContext;
  const localLines = new Set((agentSummary?.signals ?? []).map((signal) => signal.line));
  if (clone.recipient && localLines.size > 0) {
    clone.recipient.interests = clone.recipient.interests?.filter((item) => !localLines.has(item));
    clone.recipient.wishes = clone.recipient.wishes?.filter((item) => !localLines.has(item));
    clone.recipient.avoids = clone.recipient.avoids?.filter((item) => !localLines.has(item));
    if (clone.recipient.interests?.length === 0) delete clone.recipient.interests;
    if (clone.recipient.wishes?.length === 0) delete clone.recipient.wishes;
    if (clone.recipient.avoids?.length === 0) delete clone.recipient.avoids;
  }
  if (clone.occasion?.occasionContext) {
    delete clone.occasion.occasionContext.localAgentSignals;
    delete clone.occasion.occasionContext.localAgentConstraints;
    for (const [key, value] of Object.entries(clone.occasion.occasionContext)) {
      if (Array.isArray(value)) {
        const filtered = value.filter((item) => typeof item !== "string" || !localLines.has(item));
        if (filtered.length > 0) clone.occasion.occasionContext[key] = filtered;
        else delete clone.occasion.occasionContext[key];
      } else if (typeof value === "string" && localLines.has(value)) {
        delete clone.occasion.occasionContext[key];
      }
    }
  }
  return clone;
}

export function buildLocalAgentContextResponse(
  agentSummary: AgentContextSummary | null,
  opts: { requested: boolean; envEnabled: boolean; exposeLines?: boolean },
): Record<string, unknown> {
  if (!agentSummary) {
    return {
      enabled: false,
      requested: opts.requested,
      reason: opts.requested && !opts.envEnabled ? "env_disabled" : "not_requested",
    };
  }
  return {
    enabled: agentSummary.enabled,
    requested: opts.requested,
    scannedFiles: agentSummary.scannedFiles,
    matchedFiles: agentSummary.matchedFiles,
    sources: agentSummary.sources,
    signalCount: agentSummary.signals.length,
    ...(opts.exposeLines ? { lines: agentSummary.safeLines.slice(0, 6) } : {}),
  };
}
