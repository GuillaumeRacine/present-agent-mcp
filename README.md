# Present Agent MCP

> Find **5 explainable, personalized gift recommendations** from inside any MCP client — Claude Code, Codex, Cursor, and more.

Current status and split guidance: [`docs/STATUS.md`](docs/STATUS.md).

Present Agent is a gifting engine that reasons about the **relationship, occasion, and the signal a gift sends** — not just product search. This package is the **public, hosted** MCP server: it calls the live Present Agent API at [presentagent.vip](https://presentagent.vip), so you need **no local product catalog, no Shopify credentials, and no model-provider API keys** to get value.

- 🎁 5 curated picks, each with a plain-language reason it fits
- 🔌 Works in any MCP-capable client over stdio
- 🔒 Hosted by default — zero secrets to configure
- 🌐 Every result includes a shareable web URL you can open or continue in the browser

**Full docs & client catalog:** https://presentagent.vip/mcp

---

## Quickstart

### Claude Code

```bash
claude mcp add present-agent --transport stdio --scope user \
  -e PRESENT_AGENT_CLIENT=claude-code \
  -- npx -y present-agent-mcp
```

Then ask Claude, in any project:

> Find a gift for my sister's birthday under $100. She just got into pottery.

### Codex

One command writes the config to `~/.codex/config.toml`:

```bash
npx -y present-agent-mcp setup codex
```

Use `--dry-run` to preview without writing, or `--local-context` to enable opt-in local context (see [Local context mode](#local-context-mode-opt-in)). Restart Codex, then ask for a gift.

### Any other MCP client (generic stdio config)

```json
{
  "mcpServers": {
    "present-agent": {
      "command": "npx",
      "args": ["-y", "present-agent-mcp"],
      "env": { "PRESENT_AGENT_CLIENT": "custom" }
    }
  }
}
```

> **Requirements:** Node.js ≥ 18 and network access to `https://presentagent.vip`. The first run downloads the package via `npx`; subsequent runs are cached.

---

## Tools

### `present_find_gift`

Find 5 personalized gifts through the hosted Present Agent API. **Only `recipient` is required** — every other field sharpens the picks but is optional.

| Parameter | Type | Description |
|-----------|------|-------------|
| `recipient` | string · **required** | Name or short description of who the gift is for. |
| `relationship` | string | partner, parent, sibling, friend, colleague, client, etc. |
| `occasion` | string | birthday, anniversary, thank-you, housewarming, onboarding, holiday… |
| `budget` | string | Free-form: `"$50-100"`, `"under $75"`, `"$150 CAD"`. Prices are **CAD**. |
| `interests` | string | Comma-separated interests, hobbies, brands, or taste signals. |
| `preferences` | string | Known likes, style, taste, or profile clues. |
| `constraints` | string | **Hard** rules: avoid categories, delivery deadline, allergies, space, values. |
| `needs` | string | Functional needs or outcomes the gift should support. |
| `giver_context` | string | What you (the host AI) know about the **giver**: budget norms, taste, taboos, prior gifts. Leave empty if unknown — never fabricate. |
| `recipient_context` | string | What you know about the **recipient** beyond name/relation/occasion: life events, prior gift outcomes, recent notes. Leave empty if unknown — never fabricate. |
| `useAgentContext` | boolean | Opt in to local context search. Also requires `PRESENT_ENABLE_LOCAL_AGENT_CONTEXT=1`. Default `false`. |

**Returns** (JSON text):

```json
{
  "mode": "hosted",
  "apiBase": "https://presentagent.vip",
  "sessionId": "51bd7b67-…",
  "picksUrl": "https://presentagent.vip/picks/51bd7b67-…",
  "contextSignals": { "hosted": { "sources": ["explicit input"] } },
  "recommendations": [
    {
      "slot": "top_pick",
      "name": "White — Sage Valley Pottery Pie Dish",
      "brand": "PRINTFRESH",
      "price": 60,
      "matchScore": 0.5,
      "whyThisFits": "Combines her love of pottery with practical kitchen artistry…",
      "giftAngle": "Present it as functional art she'll use regularly."
    }
  ]
}
```

`picksUrl` is a real, shareable page — open it, send it, or continue refining in the browser.

### `present_beta_start`

Zero-argument tool that returns the fastest onboarding instructions, a live web fallback (`/gift/new`), and the local-context opt-in hint. Useful as a first call to orient a fresh agent.

---

## How to get the best picks

The engine reasons from context. The more **specific, true** signal you give it, the better the 5 picks — but don't invent detail.

**Do**
- Name a concrete **interest or recent change** ("just got into pottery", "started trail running"). Specifics beat adjectives.
- State the **relationship and occasion** — they change what a gift *signals*.
- Put genuine **hard limits in `constraints`** ("no alcohol", "ships to Canada by Dec 20", "nut allergy"). Constraints are respected before scoring.
- Pass through real memory in `giver_context` / `recipient_context` when your host AI already knows it.

**Don't**
- Fabricate interests or budgets to "fill the form" — empty is better than wrong; the model treats blanks honestly.
- Expect it to read minds: "something nice" with no other signal yields generic picks.
- Use it to search a specific SKU — it recommends *what to give*, it isn't a product-lookup tool.

**Good call:**
> `present_find_gift({ recipient: "my dad", relationship: "parent", occasion: "birthday", budget: "$80-120", interests: "gardening, espresso, jazz vinyl", constraints: "no clothing, he's hard to surprise" })`

---

## What's feasible (and what isn't)

| ✅ Feasible | ❌ Not in this MCP |
|-------------|--------------------|
| 5 explainable gift picks for a person + occasion | Completing a purchase / checkout (happens on the web, link provided) |
| Budget, hard constraints, and taste honored | Real-time inventory or per-item shipping quotes (confirmed at checkout) |
| A shareable `picksUrl` for every result | Editing a saved recipient profile or wishlist (web/app feature) |
| Optional, opt-in local context hints | Reading your full local files (only sanitized, opt-in signals are sent) |
| Works offline-of-keys: no model/Shopify keys needed | Running the full local catalog engine (that's the private app repo) |

**Practical notes**
- **Latency:** a fresh recommendation runs live LLM scoring and typically takes **~20–60s**. Repeat/cached contexts are faster.
- **Currency:** all prices are **CAD**.
- **Checkout:** to buy, open `picksUrl` and continue on `presentagent.vip` → secure Shopify checkout. The MCP never hands users to external retailers.
- **Determinism:** picks are personalized and may vary slightly run-to-run as context changes.

---

## Local context mode (opt-in)

By default the hosted server uses **only what you pass in the tool call**. Nothing local is read.

To let it look at local Claude/Codex/Gemini context files for soft signals about the named recipient, **both** must be true:

1. Set `PRESENT_ENABLE_LOCAL_AGENT_CONTEXT=1` in the server env, **and**
2. Pass `useAgentContext: true` on the tool call.

When enabled, the server extracts compact **preference / need / constraint** hints and sends them as *weak* signals (never hard requirements). **Secret-looking lines and paths are skipped** — raw files are never transmitted. These hints are clearly labeled in the request and treated as low-confidence flavour, behind anything you state explicitly.

---

## Configuration

All environment variables are **optional** — the package runs with safe defaults and **no secrets**. See [`.env.example`](.env.example).

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRESENT_AGENT_CLIENT` | `unknown` | Client label for attribution (e.g. `claude-code`, `codex`). |
| `PRESENT_AGENT_API_BASE` | `https://presentagent.vip` | API base. Change only if self-hosting Present Agent. |
| `PRESENT_ENABLE_LOCAL_AGENT_CONTEXT` | unset (off) | Allow opt-in local context search (still needs `useAgentContext=true`). |
| `PRESENT_EXPOSE_LOCAL_AGENT_CONTEXT_LINES` | unset (off) | Echo extracted local lines in the response (debug only). |

---

## Privacy

- **No keys, no accounts** required to use the hosted tools.
- The server sends only the **gift context you provide** to `presentagent.vip`.
- Local context search is **off by default**, double-gated, sanitized, and never transmits raw files or secret-looking content.
- Requests carry an attribution label (`source: "mcp"`, your `PRESENT_AGENT_CLIENT`) for analytics — no personal identifiers are added by this package.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `failed to start` / command not found | Ensure Node.js ≥ 18 and that `npx` can reach the network on first run. |
| Tool call times out | Recommendations can take up to ~60s; raise your client's MCP tool timeout. |
| Empty / generic picks | Add a concrete interest + relationship + occasion; avoid vague input. |
| Want to preview Codex config | `npx -y present-agent-mcp setup codex --dry-run` |

---

## Run from source

```bash
git clone https://github.com/GuillaumeRacine/present-agent-mcp
cd present-agent-mcp
npm install
npm start            # boots the stdio MCP server
```

---

## License

MIT © Present Agent. See [LICENSE](LICENSE).
