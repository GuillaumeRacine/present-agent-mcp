---
description: Find a personalized gift through Present Agent MCP.
argument-hint: [recipient, occasion, budget, preferences, needs, constraints]
---

# Gift Finder

Find the right gift through the hosted Present Agent MCP server.

Source-of-truth implementation notes for context, privacy, and persistence live in `docs/mcp/gift-agent-context.md`.
Claude Code plugin setup and distribution live in `docs/mcp/claude-code-gift-plugin.md`.

## Usage

`/gift [anything about who and what]`

Examples:

- `/gift`
- `/gift Lisa birthday`
- `/gift something for Theodore, he's turning 5, loves dinosaurs`
- `/gift need a last-minute thing for my mom`

## Available Hosted Tools

The GitHub-hosted MCP server currently exposes only:

- `present_find_gift` - hosted gift recommendations
- `present_beta_start` - setup guide and web fallback

Do not call or mention unavailable Present Agent tools such as `present_list_recipients`, `present_recipient_profile`, `present_context_intake`, `present_generate_card`, `present_mark_given`, `present_occasions`, or `present_wishlist` unless they are actually visible in the current Claude Code MCP tool list.

## Hard Rules

- Use `present_find_gift` for recommendations. Do not invent products.
- Never fall back to `curl`, localhost APIs, SQLite, repository scripts, or direct product DB queries when the MCP tool is missing or disconnected.
- If `present_find_gift` is unavailable, stop and tell the user to restart Claude Code or reconnect the MCP server:
  `claude mcp remove present-agent -s user && claude mcp add present-agent --transport stdio --scope user -e PRESENT_AGENT_CLIENT=claude-code -- npx -y present-agent-mcp`
- Ask at most one short clarification before recommendations.
- If every returned `matchScore` is `0.5`, say plainly that ranking fell back to generic mode and ask for a tighter refinement. Do not pretend the list is personalized.
- Keep all recommendation links exactly as returned by Present Agent.
- The web picks page is the primary review surface for images, full details, and richer product context. After every successful `present_find_gift` call, show the `picksUrl` first and immediately run `open "<picksUrl>"` without asking.

## No-Argument Flow

If the user runs `/gift` with no details:

1. If Google Calendar tools are available, scan the next 90 days for birthdays, anniversaries, holidays, and clearly gift-worthy events.
2. Show a short dashboard with `Who | Occasion | Date | Days Away | Status`.
3. Ask which person to tackle first, or suggest the nearest obvious gift occasion.

Do not claim saved-recipient DB access through Present Agent in hosted mode. The hosted MCP beta does not expose that tool yet.

## With-Context Flow

Extract:

- `recipient`
- `relationship`
- `occasion`
- `budget`
- `interests`
- `preferences`
- `needs`
- `constraints`

If the user gives a child age or birthday age, make age fit a hard constraint. For example, Theodore turning 5 should be sent as:

- `recipient`: `Theodore, age 5`
- `occasion`: `5th birthday`
- `interests`: `dinosaurs, swimming, outdoor play, puzzles, building things together`
- `constraints`: `age-appropriate for a 5-year-old; no adult hobby kits; no jewelry; no senior/adult gifts; no products meant for adults unless explicitly kid-safe`

For any child recipient, include:

- exact age when known
- age-appropriate constraint
- hard avoids for adult/senior/romantic/jewelry/home-decor filler unless the user explicitly asked for it

## AI Memory Passthrough

Before calling `present_find_gift`, populate the host-memory context fields when you actually know useful details:

- `giver_context`: Compile what you know about the user/giver from saved memory, current conversation, AGENTS.md, CLAUDE.md, prior gift discussions, accessibility needs, budget patterns, taboo categories, and personal taste signals.
- `recipient_context`: Compile what you know about the recipient beyond name, relationship, and occasion: recent life events, hobbies, prior gift outcomes, repeated notes from the giver, or relevant current-chat context.

Hallucination rule: if you do not actually know anything useful for one of these fields, pass an empty string or omit it. Never fabricate. Better to under-populate than invent.

## Recommendation Call

Call `present_find_gift` with:

- `recipient`
- `relationship`
- `occasion`
- `budget` - default `$50-150` if missing
- `interests`
- `preferences`
- `needs`
- `constraints`
- `giver_context`
- `recipient_context`
- `useAgentContext` - only `true` if the user explicitly asks to use local Claude/Codex/Gemini context and the MCP server was installed with `PRESENT_ENABLE_LOCAL_AGENT_CONTEXT=1`

Show all returned recommendations:

| Slot | Product | Price | Score | Why This Fits |
|------|---------|-------|-------|---------------|

For each card, include:

- product name and brand
- price
- match score
- why it fits
- what it says, if returned
- buy URL

Before or alongside the table, send the user to the web review page:

1. Find `picksUrl` in the `present_find_gift` response. If it is missing but `sessionId` is present, construct `https://presentagent.vip/picks/<sessionId>`.
2. Say: `I opened the full web review page so you can inspect images, details, and feedback controls: <picksUrl>`.
3. Run `open "<picksUrl>"` automatically. Do not ask first.
4. Still show a compact text summary in Claude so the user has the gist in the terminal.

## Refinement

If the user says the picks are wrong, ask what to change only if it is not already clear.

Examples:

- "Only dinosaurs and building toys."
- "No adult kits."
- "More outdoor/swimming options."
- "Under $75."
- "More like the first one."

Then re-run `present_find_gift` with the tighter interests and constraints. Do not re-use products the user rejected if product IDs are available.

---

<!-- DEPLOYMENT NOTE (plugin distribution - do not remove):
This file is the canonical sanitized standalone alias template for exact `/gift`.
Current Claude Code plugin skills are namespaced, so the plugin command is
`/present-agent:gift` from `plugins/present-agent/skills/gift/SKILL.md`.
Use this template only for user-local or project-local aliases such as
`~/.claude/commands/gift.md` or `.claude/commands/gift.md`.

See `docs/mcp/claude-code-gift-plugin.md` for the current distribution plan.
-->
