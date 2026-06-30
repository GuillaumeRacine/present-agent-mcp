# Current Status

Last updated: 2026-06-30

## Product Role

`present-agent-mcp` is the public MCP client/package for hosted Present gift
recommendations. It is still active because existing MCP clients can install it
and it points to the hosted `presentagent.vip` API.

Do not archive this repo until the recommendation layer replacement exists and
the MCP package has either migrated to it or been explicitly sunset.

## Source Of Truth

- GitHub: `GuillaumeRacine/present-agent-mcp`
- Local working copy:
  `/Volumes/SSD/1_Projects/Apps/present-agent/present-agent-mcp`
- Hosted API dependency today: `https://presentagent.vip`
- Cleanup tracking issue:
  `https://github.com/GuillaumeRacine/presentagent/issues/424`

## Relationship To The Split

- Commerce product: `GuillaumeRacine/present-gift-commerce`
- Context product: `GuillaumeRacine/present-gift-context`
- Legacy recommendation/API source: `GuillaumeRacine/presentagent`

Future work should move MCP calls from the legacy monolith to the planned
recommendation product once that service exists.
