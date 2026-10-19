/**
 * Offline Gemini-vs-Jev benchmark — pure logic (BACKLOG POL-3).
 *
 * The published app calls only Gemini (Devvit permits only OpenAI and Google
 * Gemini as AI providers). This module scores a local corpus with both
 * providers from a developer's machine and compares them using the app's
 * own thresholds, so a future provider decision rests on data.
 *
 * Only the AI scores are compared — the app's rule-based spam heuristics
 * need Reddit and Redis and are the same for both providers anyway.
 */
import type { AnalysisResult, ModerationRules } from "../src/types.js";
import { isGeminiFailure } from "../src/ai.js";
import { isJevFailure } from "../src/jev.js";

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

/** Signals a corpus item can be labelled with. */
export const SIGNALS = ["toxic", "spam", "bot"] as const;
export type Signal = (typeof SIGNALS)[number];

/** One line of the JSONL corpus. */
export interface CorpusItem {
  id: string;
  text: string;
  subreddit: string;
  /** Optional ground truth: should this signal be flagged? */
  expected?: Partial<Record<Signal, boolean>>;
}

/**
 * Parse a JSONL corpus. Blank lines and `//` comment lines are skipped.
 * Throws with the line number on malformed input, so a typo can't silently
 * shrink the benchmark.
 */
export function parseCorpus(jsonl: string): CorpusItem[] {
  const items: CorpusItem[] = [];
  const ids = new Set<string>();

  jsonl.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) return;
    const where = `corpus line ${index + 1}`;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj?.id !== "string" || obj.id === "") {
      throw new Error(`${where}: "id" must be a non-empty string`);
    }
    if (typeof obj.text !== "string" || obj.text.trim() === "") {
      throw new Error(`${where}: "text" must be a non-empty string`);
    }
    if (ids.has(obj.id)) throw new Error(`${where}: duplicate id "${obj.id}"`);
    ids.add(obj.id);

    const expected: Partial<Record<Signal, boolean>> = {};
    if (obj.expected !== undefined) {
      const e = obj.expected as Record<string, unknown>;
      for (const key of Object.keys(e)) {
        if (!(SIGNALS as readonly string[]).includes(key) || typeof e[key] !== "boolean") {
          throw new Error(
            `${where}: "expected" keys must be ${SIGNALS.join("/")} with boolean values`
          );
        }
        expected[key as Signal] = e[key] as boolean;
      }
    }

    items.push({
      id: obj.id,
      text: obj.text,
      subreddit: typeof obj.subreddit === "string" ? obj.subreddit : "test",
      ...(Object.keys(expected).length > 0 ? { expected } : {}),
    });
  });

  return items;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** One provider's answer for one item. */
export interface ProviderRun {
  result: AnalysisResult;
  latencyMs: number;
  failed: boolean;
}

/** Both providers' answers for one item. */
export interface BenchmarkRow {
  id: string;
  expected?: CorpusItem["expected"];
  gemini: ProviderRun;
  jev: ProviderRun;
}

/** The two providers, injected so tests can run without the network. */
export interface Providers {
  gemini: (item: CorpusItem) => Promise<AnalysisResult>;
  jev: (item: CorpusItem) => Promise<AnalysisResult>;
}

/** Wall-clock source, injectable for deterministic tests. */
export type Clock = () => number;

async function timed(
  fn: () => Promise<AnalysisResult>,
  isFailure: (r: AnalysisResult) => boolean,
  now: Clock
): Promise<ProviderRun> {
  const start = now();
  const result = await fn();
  return { result, latencyMs: now() - start, failed: isFailure(result) };
}

/**
 * Score every item with both providers. Each item's two calls run in
 * parallel and are timed separately; at most `concurrency` items are in
 * flight, to stay polite to both APIs. Rows keep corpus order.
 */
export async function runBenchmark(
  items: CorpusItem[],
  providers: Providers,
  { concurrency = 2, now = Date.now }: { concurrency?: number; now?: Clock } = {}
): Promise<BenchmarkRow[]> {
  const rows: BenchmarkRow[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      const [gemini, jev] = await Promise.all([
        timed(() => providers.gemini(item), isGeminiFailure, now),
        timed(() => providers.jev(item), isJevFailure, now),
      ]);
      rows[index] = {
        id: item.id,
        ...(item.expected ? { expected: item.expected } : {}),
        gemini,
        jev,
      };
    }
  };

  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return rows;
}

// ---------------------------------------------------------------------------
// Decisions — mirror the app's thresholds (moderation.ts)
// ---------------------------------------------------------------------------

export type ToxicityAction = "remove" | "flag" | "none";

export function toxicityAction(r: AnalysisResult, rules: ModerationRules): ToxicityAction {
  if (r.toxicityScore >= rules.toxicityRemoveThreshold) return "remove";
  if (r.toxicityScore >= rules.toxicityFlagThreshold) return "flag";
  return "none";
}

/** Would this signal be flagged (or removed) under `rules`? */
export function flags(signal: Signal, r: AnalysisResult, rules: ModerationRules): boolean {
  switch (signal) {
    case "toxic":
      return r.toxicityScore >= rules.toxicityFlagThreshold;
    case "spam":
      return r.spamScore >= rules.spamFlagThreshold;
    case "bot":
      return r.botLikelihood >= rules.botFlagThreshold;
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface LatencyStats {
  ok: number;
  failed: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
}

export interface BenchmarkSummary {
  items: number;
  /** Items where both providers returned a real answer. */
  compared: number;
  latency: { gemini: LatencyStats; jev: LatencyStats };
  meanAbsDelta: { toxicity: number | null; spam: number | null; bot: number | null };
  agreement: {
    toxicityAction: number | null;
    spamFlag: number | null;
    botFlag: number | null;
    sentiment: number | null;
  };
  /** Per-signal confusion counts at the flag threshold (labelled items only). */
  accuracy: Record<Signal, { gemini: Confusion; jev: Confusion }>;
}

/** Nearest-rank percentile of a non-empty list. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const round = (x: number | null, digits = 4): number | null =>
  x === null ? null : Number(x.toFixed(digits));

function latencyStats(runs: ProviderRun[]): LatencyStats {
  const ok = runs.filter((r) => !r.failed).map((r) => r.latencyMs);
  return {
    ok: ok.length,
    failed: runs.length - ok.length,
    meanMs: round(mean(ok), 1),
    p50Ms: ok.length ? percentile(ok, 50) : null,
    p95Ms: ok.length ? percentile(ok, 95) : null,
  };
}

function confusion(pairs: Array<[predicted: boolean, actual: boolean]>): Confusion {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const [p, a] of pairs) {
    if (p && a) tp++;
    else if (p && !a) fp++;
    else if (!p && a) fn++;
    else tn++;
  }
  return {
    tp,
    fp,
    fn,
    tn,
    precision: tp + fp === 0 ? null : round(tp / (tp + fp)),
    recall: tp + fn === 0 ? null : round(tp / (tp + fn)),
  };
}

/** Rate of `true` in a list, or null when empty. */
const rate = (bools: boolean[]): number | null =>
  bools.length === 0 ? null : round(bools.filter(Boolean).length / bools.length);

/**
 * Compare the providers. Score deltas and agreement use only items where
 * both answered; accuracy counts each provider on its own successful calls.
 */
export function summarize(rows: BenchmarkRow[], rules: ModerationRules): BenchmarkSummary {
  const both = rows.filter((r) => !r.gemini.failed && !r.jev.failed);
  const g = (r: BenchmarkRow) => r.gemini.result;
  const j = (r: BenchmarkRow) => r.jev.result;

  const accuracy = {} as BenchmarkSummary["accuracy"];
  for (const signal of SIGNALS) {
    const labelled = rows.filter((r) => r.expected?.[signal] !== undefined);
    const forProvider = (side: "gemini" | "jev") =>
      confusion(
        labelled
          .filter((r) => !r[side].failed)
          .map((r) => [flags(signal, r[side].result, rules), r.expected![signal]!])
      );
    accuracy[signal] = { gemini: forProvider("gemini"), jev: forProvider("jev") };
  }

  return {
    items: rows.length,
    compared: both.length,
    latency: {
      gemini: latencyStats(rows.map((r) => r.gemini)),
      jev: latencyStats(rows.map((r) => r.jev)),
    },
    meanAbsDelta: {
      toxicity: round(mean(both.map((r) => Math.abs(g(r).toxicityScore - j(r).toxicityScore)))),
      spam: round(mean(both.map((r) => Math.abs(g(r).spamScore - j(r).spamScore)))),
      bot: round(mean(both.map((r) => Math.abs(g(r).botLikelihood - j(r).botLikelihood)))),
    },
    agreement: {
      toxicityAction: rate(both.map((r) => toxicityAction(g(r), rules) === toxicityAction(j(r), rules))),
      spamFlag: rate(both.map((r) => flags("spam", g(r), rules) === flags("spam", j(r), rules))),
      botFlag: rate(both.map((r) => flags("bot", g(r), rules) === flags("bot", j(r), rules))),
      sentiment: rate(both.map((r) => g(r).sentiment === j(r).sentiment)),
    },
    accuracy,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const fmt = (x: number | null, unit = ""): string => (x === null ? "—" : `${x}${unit}`);
const pct = (x: number | null): string => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

/** Plain-text report for the terminal. */
export function formatReport(s: BenchmarkSummary, models: { gemini: string; jev: string }): string {
  const lines = [
    `Gemini (${models.gemini}) vs Jev (${models.jev}) — ${s.items} items, ${s.compared} answered by both`,
    "",
    "Latency          ok  failed    mean     p50     p95",
  ];
  for (const side of ["gemini", "jev"] as const) {
    const l = s.latency[side];
    lines.push(
      `  ${side.padEnd(12)} ${String(l.ok).padStart(4)}  ${String(l.failed).padStart(6)}` +
        `  ${fmt(l.meanMs, "ms").padStart(6)}  ${fmt(l.p50Ms, "ms").padStart(6)}  ${fmt(l.p95Ms, "ms").padStart(6)}`
    );
  }
  lines.push(
    "",
    `Mean |Δ score|   toxicity ${fmt(s.meanAbsDelta.toxicity)} · spam ${fmt(s.meanAbsDelta.spam)} · bot ${fmt(s.meanAbsDelta.bot)}`,
    `Agreement        toxicity action ${pct(s.agreement.toxicityAction)} · spam flag ${pct(s.agreement.spamFlag)} · ` +
      `bot flag ${pct(s.agreement.botFlag)} · sentiment ${pct(s.agreement.sentiment)}`,
    "",
    "Accuracy at the flag threshold (labelled items)   precision / recall"
  );
  for (const signal of SIGNALS) {
    const a = s.accuracy[signal];
    const labelled = a.gemini.tp + a.gemini.fp + a.gemini.fn + a.gemini.tn;
    if (labelled === 0 && a.jev.tp + a.jev.fp + a.jev.fn + a.jev.tn === 0) continue;
    lines.push(
      `  ${signal.padEnd(6)} gemini ${pct(a.gemini.precision)} / ${pct(a.gemini.recall)}` +
        `   jev ${pct(a.jev.precision)} / ${pct(a.jev.recall)}`
    );
  }
  return lines.join("\n");
}
