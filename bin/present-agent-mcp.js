#!/usr/bin/env node

// Present Agent MCP — public hosted launcher.
// `npx -y present-agent-mcp` boots the stdio MCP server,
// which calls the hosted Present Agent API at https://presentagent.vip.
// No local catalog DB, Shopify credentials, or model-provider keys required.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const INSTALL_SPEC = process.env.PRESENT_AGENT_INSTALL_SPEC || "present-agent-mcp";

function printSetupUsage() {
  console.log(`Present Agent MCP

Usage:
  npx -y ${INSTALL_SPEC}                              Start the MCP stdio server.
  npx -y ${INSTALL_SPEC} setup codex [--local-context] [--dry-run]

Commands:
  setup codex       Add Present Agent MCP to ~/.codex/config.toml.

Options:
  --local-context   Enable opt-in local Claude/Codex/Gemini context hints.
  --dry-run         Print the planned config without writing files.

After setup, restart your client and ask:
  Use present-agent to find a gift for my sister under $100.

Docs: https://presentagent.vip/mcp
`);
}

function replaceTomlSection(content, sectionName, replacement) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === sectionName);
  if (start === -1) {
    const prefix = content.trim().length > 0 ? `${content.replace(/\s*$/, "")}\n\n` : "";
    return `${prefix}${replacement}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const next = [
    ...lines.slice(0, start),
    ...replacement.split("\n"),
    ...lines.slice(end),
  ];
  return `${next.join("\n").replace(/\s*$/, "")}\n`;
}

function runCodexSetup(args) {
  const localContext = args.includes("--local-context");
  const dryRun = args.includes("--dry-run");
  const configPath = process.env.CODEX_CONFIG || path.join(os.homedir(), ".codex", "config.toml");
  const envEntries = [
    'PRESENT_AGENT_CLIENT = "codex"',
    localContext ? 'PRESENT_ENABLE_LOCAL_AGENT_CONTEXT = "1"' : null,
  ].filter(Boolean).join(", ");
  const block = [
    "[mcp_servers.present-agent]",
    'command = "npx"',
    `args = ["-y", "${INSTALL_SPEC}"]`,
    `env = { ${envEntries} }`,
  ].join("\n");

  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const next = replaceTomlSection(existing, "[mcp_servers.present-agent]", block);

  if (dryRun) {
    console.log(JSON.stringify({
      action: "setup-codex",
      configPath,
      localContext,
      wouldChange: existing !== next,
      block,
    }, null, 2));
    return 0;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, next);

  console.log("Present Agent MCP installed for Codex.");
  console.log(`Updated: ${configPath}`);
  console.log("");
  console.log(block);
  console.log("");
  console.log("Restart Codex, then ask: Use present-agent to find a gift for my sister under $100.");
  if (localContext) {
    console.log("Local context mode is enabled. In tool calls, useAgentContext=true remains opt-in.");
  }
  return 0;
}

function runSetup(argv) {
  const target = argv[0];
  if (!target || target === "--help" || target === "-h") {
    printSetupUsage();
    return 0;
  }
  if (target !== "codex") {
    console.error(`Unsupported setup target: ${target}`);
    printSetupUsage();
    return 2;
  }
  return runCodexSetup(argv.slice(1));
}

const argv = process.argv.slice(2);
if (argv[0] === "setup" || argv[0] === "--help" || argv[0] === "-h") {
  const code = argv[0] === "setup" ? runSetup(argv.slice(1)) : (printSetupUsage(), 0);
  process.exit(code);
}

const tsxCli = require.resolve("tsx/cli");
const serverPath = path.resolve(__dirname, "../src/server.ts");

const child = spawn(process.execPath, [tsxCli, serverPath], {
  stdio: "inherit",
  env: {
    NEXT_PUBLIC_APP_URL: "https://presentagent.vip",
    PRESENT_AGENT_API_BASE: "https://presentagent.vip",
    ...process.env,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("[present-agent-mcp] failed to start:", error);
  process.exit(1);
});
