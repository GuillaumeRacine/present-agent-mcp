import fs from "fs";
import os from "os";
import path from "path";
import { sanitizeForPrompt } from "./sanitize";
import type { GiftContext } from "./types";

export type AgentContextSignalType =
  | "preference"
  | "avoid"
  | "need"
  | "constraint"
  | "occasion"
  | "relationship"
  | "memory";

export interface AgentContextSignal {
  type: AgentContextSignalType;
  source: string;
  line: string;
  confidence: number;
}

export interface AgentContextSummary {
  enabled: boolean;
  scannedFiles: number;
  matchedFiles: number;
  sources: string[];
  signals: AgentContextSignal[];
  safeLines: string[];
  contextPatch: Partial<GiftContext>;
}

export interface AgentContextSearchInput {
  recipientName?: string | null;
  relationship?: string | null;
  occasion?: string | null;
  interests?: string[] | string | null;
  preferences?: string | null;
  constraints?: string | null;
  needs?: string | null;
  roots?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

const DEFAULT_MAX_FILES = 120;
const DEFAULT_MAX_FILE_BYTES = 80_000;
const DEFAULT_MAX_TOTAL_BYTES = 2_000_000;
const MAX_SIGNALS = 16;

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
]);

const DENY_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "cache",
  "plugins",
  "logs",
  "sqlite",
  "_CodeSignature",
]);

const SECRET_PATH_RE = /(?:^|[/\\])(?:auth|token|tokens|secret|secrets|credential|credentials|cookie|cookies|key|keys|password|google_accounts|installation_id|mcp\.json|settings\.json|config\.toml)(?:$|[/\\.\\-\\w]*)/i;
const SECRET_LINE_RE = /\b(api[_-]?key|authorization|bearer\s+[a-z0-9._-]+|refresh[_-]?token|access[_-]?token|client[_-]?secret|password|cookie|private[_-]?key|aws[_-]?access[_-]?key)\b/i;
const SECRET_VALUE_RE = /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const LONG_HEX_RE = /\b[a-f0-9]{24,}\b/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /\+?\b(?:\d[\s().-]?){8,}\d\b/g;

const CLASSIFIERS: Array<{ type: AgentContextSignalType; re: RegExp; confidence: number }> = [
  { type: "avoid", re: /\b(avoid|avoids|hate|hates|dislike|dislikes|allergic|allergy|no\s+(?:more|alcohol|flowers|clutter|plastic|kids|toy|toys)|don't buy|do not buy|never buy)\b/i, confidence: 0.9 },
  { type: "need", re: /\b(need|needs|needed|want|wants|wanted|wish|wishes|asked for|looking for|could use|would use)\b/i, confidence: 0.82 },
  { type: "constraint", re: /\b(constraint|constraints|budget|under \$?\d+|less than \$?\d+|ship|shipping|delivery|arrive|deadline|by friday|by monday|vegan|gluten|size|small apartment)\b/i, confidence: 0.78 },
  { type: "preference", re: /\b(like|likes|love|loves|enjoy|enjoys|prefers|preference|interested in|into|hobby|hobbies|style|favorite|favourite)\b/i, confidence: 0.76 },
  { type: "occasion", re: /\b(birthday|anniversary|wedding|graduation|housewarming|christmas|holiday|mother'?s day|father'?s day|valentine)\b/i, confidence: 0.72 },
  { type: "relationship", re: /\b(mother|mom|mum|father|dad|partner|wife|husband|girlfriend|boyfriend|friend|coworker|colleague|sister|brother|daughter|son)\b/i, confidence: 0.68 },
];

export function summarizeLocalAgentContext(input: AgentContextSearchInput): AgentContextSummary {
  const roots = resolveRoots(input.roots);
  if (roots.length === 0) return emptySummary(false);

  const terms = buildSearchTerms(input);
  if (terms.length === 0) return emptySummary(true);

  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const files = collectCandidateFiles(roots, maxFiles);
  const signals: AgentContextSignal[] = [];
  const matchedSources = new Set<string>();
  let scannedFiles = 0;
  let totalBytes = 0;

  for (const candidate of files) {
    if (scannedFiles >= maxFiles || totalBytes >= maxTotalBytes || signals.length >= MAX_SIGNALS) break;
    const stat = safeLstat(candidate.file);
    if (!stat || !stat.isFile() || stat.size <= 0 || stat.size > maxFileBytes) continue;

    scannedFiles++;
    totalBytes += stat.size;
    const text = safeReadText(candidate.file, maxFileBytes);
    if (!text) continue;

    const matches = extractSignalsFromText(text, terms, candidate.provider);
    if (matches.length > 0) {
      matchedSources.add(candidate.provider);
      signals.push(...matches);
    }
  }

  const uniqueSignals = dedupeSignals(signals).slice(0, MAX_SIGNALS);
  return {
    enabled: true,
    scannedFiles,
    matchedFiles: matchedSources.size,
    sources: Array.from(matchedSources).slice(0, 8),
    signals: uniqueSignals,
    safeLines: uniqueSignals.slice(0, 6).map((s) => `${s.type}: ${s.line}`),
    contextPatch: buildContextPatch(uniqueSignals),
  };
}

function emptySummary(enabled: boolean): AgentContextSummary {
  return {
    enabled,
    scannedFiles: 0,
    matchedFiles: 0,
    sources: [],
    signals: [],
    safeLines: [],
    contextPatch: {},
  };
}

interface RootSpec {
  path: string;
  realPath: string;
  provider: string;
}

interface CandidateFile {
  file: string;
  provider: string;
  mtime: number;
}

function resolveRoots(override?: string[]): RootSpec[] {
  const raw =
    override && override.length > 0
      ? override
      : process.env.PRESENT_AGENT_CONTEXT_ROOTS
        ? process.env.PRESENT_AGENT_CONTEXT_ROOTS.split(path.delimiter)
        : defaultRoots();
  return raw
    .map((p) => expandHome(p.trim()))
    .filter(Boolean)
    .map((p) => {
      const stat = safeLstat(p);
      if (!stat || stat.isSymbolicLink()) return null;
      const realPath = safeRealpath(p);
      if (!realPath) return null;
      return { path: p, realPath, provider: providerForPath(p) };
    })
    .filter((root): root is RootSpec => !!root);
}

function defaultRoots(): string[] {
  const home = os.homedir();
  return [
    path.join(home, ".claude", "projects"),
    path.join(home, ".claude", "tasks"),
    path.join(home, ".codex", "history.jsonl"),
    path.join(home, ".codex", "session_index.jsonl"),
    path.join(home, ".codex", "ambient-suggestions"),
    path.join(home, ".gemini", "tmp"),
    path.join(home, ".gemini", "GEMINI.md"),
    path.join(home, "Context", ".claude"),
  ];
}

function expandHome(p: string): string {
  if (!p) return "";
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function collectCandidateFiles(roots: RootSpec[], maxFiles: number): CandidateFile[] {
  const out: CandidateFile[] = [];
  const queue = roots.map((root) => ({ file: root.path, root }));
  const seen = new Set<string>();

  while (queue.length > 0 && out.length < maxFiles * 4) {
    const current = queue.shift();
    if (!current || seen.has(current.file) || shouldSkipPath(current.file)) continue;
    seen.add(current.file);

    const stat = safeLstat(current.file);
    if (!stat) continue;
    if (stat.isSymbolicLink()) continue;
    const realPath = safeRealpath(current.file);
    if (!realPath || !isWithinRoot(realPath, current.root.realPath)) continue;
    if (stat.isFile()) {
      if (isCandidateTextFile(current.file)) {
        out.push({ file: current.file, provider: current.root.provider, mtime: stat.mtimeMs });
      }
      continue;
    }
    if (!stat.isDirectory()) continue;

    const entries = safeReadDir(current.file)
      .map((entry) => path.join(current.file, entry))
      .filter((entry) => !shouldSkipPath(entry))
      .map((entry) => ({ entry, stat: safeLstat(entry), realPath: safeRealpath(entry) }))
      .filter((entry): entry is { entry: string; stat: fs.Stats; realPath: string | null } => !!entry.stat)
      .filter((entry) => !entry.stat.isSymbolicLink())
      .filter((entry) => !!entry.realPath && isWithinRoot(entry.realPath, current.root.realPath))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    for (const { entry, stat: childStat } of entries) {
      if (childStat.isDirectory()) queue.push({ file: entry, root: current.root });
      else if (childStat.isFile() && isCandidateTextFile(entry)) {
        out.push({ file: entry, provider: current.root.provider, mtime: childStat.mtimeMs });
      }
    }
  }

  return out
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, maxFiles);
}

function shouldSkipPath(filePath: string): boolean {
  if (SECRET_PATH_RE.test(filePath)) return true;
  const segments = filePath.split(path.sep).filter(Boolean);
  return segments.some((segment) => DENY_SEGMENTS.has(segment));
}

function isCandidateTextFile(filePath: string): boolean {
  if (shouldSkipPath(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filePath);
  return base === "CLAUDE.md" || base === "AGENTS.md" || base === "GEMINI.md";
}

function safeLstat(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}

function safeRealpath(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function isWithinRoot(realPath: string, rootRealPath: string): boolean {
  const relative = path.relative(rootRealPath, realPath);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeReadDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

function safeReadText(filePath: string, maxBytes: number): string {
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.subarray(0, maxBytes).toString("utf8");
  } catch {
    return "";
  }
}

function buildSearchTerms(input: AgentContextSearchInput): string[] {
  const raw = [
    input.recipientName,
    input.relationship,
    input.occasion,
    ...normalizeList(input.interests),
    ...normalizeList(input.preferences),
    ...normalizeList(input.constraints),
    ...normalizeList(input.needs),
  ];
  const terms = new Set<string>();
  for (const item of raw) {
    if (!item) continue;
    const cleaned = normalizeTerm(item);
    if (cleaned.length >= 2) terms.add(cleaned);
    for (const token of cleaned.split(/\s+/)) {
      if (token.length >= 3 && !STOP_WORDS.has(token)) terms.add(token);
    }
  }
  return Array.from(terms).slice(0, 20);
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "gift",
  "gifts",
  "needs",
  "wants",
  "likes",
  "loves",
  "budget",
  "under",
]);

function normalizeList(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value
    .split(/[,;\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9$ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSignalsFromText(text: string, terms: string[], source: string): AgentContextSignal[] {
  const normalizedText = text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (!terms.some((term) => normalizedText.includes(term))) return [];

  const lines = text
    .split(/\r?\n/)
    .flatMap((line) => splitLongLineAroundTerms(line, terms))
    .slice(0, 800);
  const signals: AgentContextSignal[] = [];

  for (const line of lines) {
    if (signals.length >= 5) break;
    const normalizedLine = normalizeTerm(line);
    if (!terms.some((term) => normalizedLine.includes(term))) continue;
    const safe = safeSnippet(line);
    if (!safe) continue;
    const classifier = CLASSIFIERS.find((entry) => entry.re.test(safe));
    signals.push({
      type: classifier?.type ?? "memory",
      source,
      line: safe,
      confidence: classifier?.confidence ?? 0.55,
    });
  }
  return signals;
}

function splitLongLineAroundTerms(line: string, terms: string[]): string[] {
  if (line.length <= 700) return [line];
  const normalized = line.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const snippets: string[] = [];
  for (const term of terms) {
    const idx = normalized.indexOf(term);
    if (idx === -1) continue;
    snippets.push(line.slice(Math.max(0, idx - 240), Math.min(line.length, idx + 420)));
  }
  return snippets.length > 0 ? snippets : [];
}

function safeSnippet(line: string): string {
  if (SECRET_LINE_RE.test(line) || SECRET_VALUE_RE.test(line)) return "";
  const redacted = line
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[phone]")
    .replace(LONG_HEX_RE, "[id]");
  return sanitizeForPrompt(redacted, 180);
}

function dedupeSignals(signals: AgentContextSignal[]): AgentContextSignal[] {
  const seen = new Set<string>();
  return signals
    .sort((a, b) => b.confidence - a.confidence)
    .filter((signal) => {
      const key = `${signal.type}:${signal.line.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildContextPatch(signals: AgentContextSignal[]): Partial<GiftContext> {
  const byType = (type: AgentContextSignalType) =>
    signals
      .filter((signal) => signal.type === type)
      .map((signal) => signal.line)
      .slice(0, 5);
  const preferences = byType("preference");
  const needs = byType("need");
  const avoids = byType("avoid");
  const constraints = byType("constraint");
  const occasionSignals = signals
    .filter((signal) => signal.type === "occasion" || signal.type === "relationship" || signal.type === "memory")
    .map((signal) => signal.line)
    .slice(0, 5);

  const patch: Partial<GiftContext> = {};
  if (preferences.length || needs.length || avoids.length) {
    patch.recipient = {
      interests: preferences,
      wishes: needs,
      avoids,
    };
  }
  if (constraints.length || occasionSignals.length) {
    patch.occasion = {
      occasionContext: {
        localAgentConstraints: constraints,
        localAgentSignals: occasionSignals,
      },
    };
  }
  return patch;
}

function providerForPath(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.includes(`${path.sep}.claude${path.sep}`) || normalized.endsWith(`${path.sep}.claude`)) {
    return "claude";
  }
  if (normalized.includes(`${path.sep}.codex${path.sep}`) || normalized.endsWith(`${path.sep}.codex`)) {
    return "codex";
  }
  if (normalized.includes(`${path.sep}.gemini${path.sep}`) || normalized.endsWith(`${path.sep}.gemini`)) {
    return "gemini";
  }
  return "local-agent-context";
}
