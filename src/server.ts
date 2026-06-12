#!/usr/bin/env tsx
// Hosted MCP beta entrypoint. Calls the live Present Agent API instead of
// requiring a local catalog DB, Shopify credentials, or model-provider keys.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "url";
import { z } from "zod";
import { summarizeLocalAgentContext, type AgentContextSummary } from "./lib/agent-context";
import { buildLocalAgentContextResponse, isTruthyEnv } from "./lib/gift-context-safety";

const API_BASE = (process.env.PRESENT_AGENT_API_BASE || process.env.NEXT_PUBLIC_APP_URL || "https://presentagent.vip").replace(/\/$/, "");
const CLIENT = process.env.PRESENT_AGENT_CLIENT || "unknown";
const VERSION = "0.1.0";

const server = new McpServer({ name: "present-agent-hosted", version: VERSION });

export interface HostedGiftToolArgs {
  recipient: string;
  relationship?: string;
  occasion?: string;
  budget?: string;
  interests?: string;
  preferences?: string;
  constraints?: string;
  needs?: string;
  giver_context?: string;
  recipient_context?: string;
  useAgentContext?: boolean;
}

function splitList(value?: string | string[] | null): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (!value) return [];
  return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function compactLines(lines: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const cleaned = line?.trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function maybeSummarizeLocalContext(input: {
  recipient: string;
  relationship?: string;
  occasion?: string;
  interests?: string;
  preferences?: string;
  constraints?: string;
  needs?: string;
  giver_context?: string;
  recipient_context?: string;
  useAgentContext?: boolean;
}): AgentContextSummary | null {
  if (input.useAgentContext !== true || !isTruthyEnv(process.env.PRESENT_ENABLE_LOCAL_AGENT_CONTEXT)) return null;
  return summarizeLocalAgentContext({
    recipientName: input.recipient,
    relationship: input.relationship,
    occasion: input.occasion,
    interests: splitList(input.interests),
    preferences: input.preferences,
    constraints: input.constraints,
    needs: input.needs,
  });
}

function weakLocalAgentContextBlock(agentSummary: AgentContextSummary | null): string | null {
  const lines = agentSummary?.safeLines.slice(0, 6) ?? [];
  if (lines.length === 0) return null;
  return [
    "Local agent context (weak; do not treat as hard constraints or direct gift requirements):",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

function appendWeakContext(existing: string | undefined, agentSummary: AgentContextSummary | null): string | undefined {
  const weakBlock = weakLocalAgentContextBlock(agentSummary);
  if (!weakBlock) return existing;
  return [existing?.trim(), weakBlock].filter(Boolean).join("\n\n");
}

export function buildHostedGiftRequestBody(args: HostedGiftToolArgs, agentSummary: AgentContextSummary | null) {
  return {
    recipient: args.recipient,
    relationship: args.relationship,
    occasion: args.occasion,
    budget: args.budget,
    interests: compactLines([...splitList(args.interests), ...splitList(args.preferences)]),
    preferences: compactLines(splitList(args.preferences)),
    needs: compactLines(splitList(args.needs)),
    constraints: compactLines(splitList(args.constraints)),
    giver_context: args.giver_context,
    recipient_context: appendWeakContext(args.recipient_context, agentSummary),
    attribution: {
      source: "mcp",
      utm_source: CLIENT,
      utm_medium: "agent",
      utm_campaign: process.env.MCP_UTM_CAMPAIGN || "self_serve_beta",
      landing_path: "/mcp",
    },
  };
}

server.tool(
  "present_find_gift",
  "Find 5 personalized gifts through the hosted Present Agent API. Optional local Claude/Codex context search is opt-in.",
  {
    recipient: z.string().describe("Recipient's name or short description"),
    relationship: z.string().optional().describe("Relationship: partner, parent, friend, colleague, client, etc."),
    occasion: z.string().optional().describe("Occasion: birthday, anniversary, thank you, onboarding, housewarming, etc."),
    budget: z.string().optional().describe("Budget: '$50-100', 'under $75', '$150 CAD', etc."),
    interests: z.string().optional().describe("Comma-separated interests, hobbies, brands, or taste signals"),
    preferences: z.string().optional().describe("Known likes, style, taste, brands, hobbies, or profile clues"),
    constraints: z.string().optional().describe("Hard constraints: avoid categories, delivery deadline, allergies, space, values"),
    needs: z.string().optional().describe("Functional needs, wishes, or outcomes the gift should support"),
    giver_context: z.string().optional().describe("Host AI memory/context about the giver: preferences, budget norms, accessibility needs, taboos, prior gifts, and personal taste. Empty if unknown; never fabricate."),
    recipient_context: z.string().optional().describe("Host AI memory/context about the recipient beyond name/relation/occasion: life events, hobbies, prior gift outcomes, and recent notes. Empty if unknown; never fabricate."),
    useAgentContext: z.boolean().optional().describe("Opt in to local Claude/Codex/Gemini context search. Also requires PRESENT_ENABLE_LOCAL_AGENT_CONTEXT=1."),
  },
  async (args) => {
    const agentSummary = maybeSummarizeLocalContext(args);
    const body = buildHostedGiftRequestBody(args, agentSummary);

    const response = await fetch(`${API_BASE}/api/v1/gift`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": `present-agent-mcp/${VERSION} (${CLIENT})`,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: "hosted_api_failed", status: response.status, detail: payload }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          mode: "hosted",
          apiBase: API_BASE,
          client: CLIENT,
          sessionId: payload.sessionId,
          picksUrl: payload.sessionId ? `${API_BASE}/picks/${payload.sessionId}` : null,
          contextSignals: {
            hosted: payload.contextSignals,
            localAgentContext: buildLocalAgentContextResponse(agentSummary, {
              requested: args.useAgentContext === true,
              envEnabled: isTruthyEnv(process.env.PRESENT_ENABLE_LOCAL_AGENT_CONTEXT),
              exposeLines: isTruthyEnv(process.env.PRESENT_EXPOSE_LOCAL_AGENT_CONTEXT_LINES),
            }),
          },
          recommendations: payload.recommendations,
        }, null, 2),
      }],
    };
  },
);

server.tool(
  "present_beta_start",
  "Return the fastest beta onboarding instructions and live web fallback.",
  {},
  async () => ({
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        status: "ready",
        tryNow: "Ask: Find a gift for my sister's birthday under $100. She just got into pottery.",
        webFallback: `${API_BASE}/gift/new`,
        setupGuide: `${API_BASE}/mcp`,
        localContext: "Set PRESENT_ENABLE_LOCAL_AGENT_CONTEXT=1 and pass useAgentContext=true to opt in to local Claude/Codex context search.",
      }, null, 2),
    }],
  }),
);

async function main() {
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[present-agent-hosted-mcp] fatal:", error);
    process.exit(1);
  });
}
