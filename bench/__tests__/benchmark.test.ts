import { describe, it, expect } from "vitest";
import {
  parseCorpus,
  runBenchmark,
  summarize,
  formatReport,
  percentile,
  toxicityAction,
  type CorpusItem,
} from "../benchmark.js";
import { ANALYSIS_FALLBACK, DEFAULT_RULES } from "../../src/types.js";
import type { AnalysisResult } from "../../src/types.js";

const scores = (
  toxicityScore: number,
  spamScore = 0,
  botLikelihood = 0,
  sentiment: AnalysisResult["sentiment"] = "neutral"
): AnalysisResult => ({ toxicityScore, spamScore, botLikelihood, sentiment, reason: "model reason" });

/** A clock that advances by the next value in `steps` on each read. */
function steppingClock(steps: number[]) {
  let t = 0;
  let i = 0;
  return () => (t += steps[i++ % steps.length]);
}

// ---------------------------------------------------------------------------

describe("parseCorpus", () => {
  it("parses JSONL, skipping blank and // comment lines", () => {
    const items = parseCorpus(
      [
        "// header",
        "",
        '{"id":"a","text":"hello","subreddit":"x","expected":{"toxic":false}}',
        '{"id":"b","text":"spam!"}',
      ].join("\n")
    );
    expect(items).toEqual([
      { id: "a", text: "hello", subreddit: "x", expected: { toxic: false } },
      { id: "b", text: "spam!", subreddit: "test" },
    ]);
  });

  it.each([
    ["not json", "not valid JSON"],
    ['{"text":"x"}', '"id"'],
    ['{"id":"a","text":"  "}', '"text"'],
    ['{"id":"a","text":"x","expected":{"rude":true}}', '"expected"'],
    ['{"id":"a","text":"x","expected":{"toxic":"yes"}}', '"expected"'],
  ])("rejects %s with the line number", (line, message) => {
    expect(() => parseCorpus(line)).toThrow(/corpus line 1/);
    expect(() => parseCorpus(line)).toThrow(message);
  });

  it("rejects duplicate ids", () => {
    expect(() => parseCorpus('{"id":"a","text":"x"}\n{"id":"a","text":"y"}')).toThrow(
      /line 2: duplicate id "a"/
    );
  });

  it("parses the shipped example corpus", async () => {
    const { readFileSync } = await import("node:fs");
    const items = parseCorpus(readFileSync("bench/corpus.example.jsonl", "utf8"));
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.every((i) => i.expected)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("runBenchmark", () => {
  const items: CorpusItem[] = [
    { id: "a", text: "one", subreddit: "s" },
    { id: "b", text: "two", subreddit: "s", expected: { toxic: true } },
    { id: "c", text: "three", subreddit: "s" },
  ];

  it("calls both providers per item, keeps corpus order, and flags failures", async () => {
    const rows = await runBenchmark(
      items,
      {
        gemini: async (i) => (i.id === "c" ? { ...ANALYSIS_FALLBACK, reason: "timeout" } : scores(0.1)),
        jev: async (i) => (i.id === "a" ? { ...ANALYSIS_FALLBACK, reason: "jev api error 429" } : scores(0.2)),
      },
      { concurrency: 2 }
    );

    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => [r.gemini.failed, r.jev.failed])).toEqual([
      [false, true],
      [false, false],
      [true, false],
    ]);
    expect(rows[1].expected).toEqual({ toxic: true });
  });

  it("times each provider separately", async () => {
    // Calls interleave as: gemini start, jev start, gemini end, jev end
    const now = steppingClock([1, 1, 100, 1000]);
    const rows = await runBenchmark(
      [items[0]],
      { gemini: async () => scores(0), jev: async () => scores(0) },
      { concurrency: 1, now }
    );
    expect(rows[0].gemini.latencyMs).toBeGreaterThan(0);
    expect(rows[0].jev.latencyMs).toBeGreaterThan(0);
    expect(rows[0].gemini.latencyMs).not.toBe(rows[0].jev.latencyMs);
  });

  it("never runs more than `concurrency` items at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return scores(0);
    };
    const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i), text: "t", subreddit: "s" }));

    await runBenchmark(many, { gemini: slow, jev: slow }, { concurrency: 3 });
    // Each item makes two parallel calls, so the peak is 2 × concurrency
    expect(peak).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------

describe("summarize", () => {
  const run = (result: AnalysisResult, latencyMs: number, failed = false) => ({ result, latencyMs, failed });

  const rows = [
    // Both agree: toxic, removed
    { id: "1", expected: { toxic: true }, gemini: run(scores(0.9), 800), jev: run(scores(0.95), 100) },
    // Disagree on action: gemini flags (0.7), jev none (0.2); jev wrong on the label
    { id: "2", expected: { toxic: true }, gemini: run(scores(0.7), 1200), jev: run(scores(0.2), 120) },
    // Both clean; sentiment differs
    { id: "3", expected: { toxic: false }, gemini: run(scores(0.1, 0, 0, "positive"), 900), jev: run(scores(0.1), 90) },
    // Jev failed — excluded from deltas and agreement, counted for gemini
    {
      id: "4",
      expected: { toxic: false },
      gemini: run(scores(0.65), 1000),
      jev: run({ ...ANALYSIS_FALLBACK, reason: "timeout or network error" }, 3000, true),
    },
  ];

  const s = summarize(rows, DEFAULT_RULES);

  it("counts items and successful comparisons", () => {
    expect(s.items).toBe(4);
    expect(s.compared).toBe(3);
  });

  it("reports latency over successful calls only", () => {
    expect(s.latency.gemini).toEqual({ ok: 4, failed: 0, meanMs: 975, p50Ms: 900, p95Ms: 1200 });
    expect(s.latency.jev).toEqual({ ok: 3, failed: 1, meanMs: 103.3, p50Ms: 100, p95Ms: 120 });
  });

  it("averages absolute score differences where both answered", () => {
    // |0.9-0.95| + |0.7-0.2| + |0.1-0.1| = 0.55 → / 3
    expect(s.meanAbsDelta.toxicity).toBeCloseTo(0.1833, 4);
    expect(s.meanAbsDelta.spam).toBe(0);
  });

  it("measures agreement under the app's thresholds", () => {
    expect(s.agreement.toxicityAction).toBeCloseTo(2 / 3, 4);
    expect(s.agreement.sentiment).toBeCloseTo(2 / 3, 4);
    expect(s.agreement.spamFlag).toBe(1);
  });

  it("scores each provider against labels at the flag threshold", () => {
    // gemini: 1 TP, 2 TP, 3 TN, 4 FP (0.65 ≥ 0.60)
    expect(s.accuracy.toxic.gemini).toMatchObject({ tp: 2, fp: 1, fn: 0, tn: 1, precision: 0.6667, recall: 1 });
    // jev: 1 TP, 2 FN, 3 TN (4 failed → not counted)
    expect(s.accuracy.toxic.jev).toMatchObject({ tp: 1, fp: 0, fn: 1, tn: 1, precision: 1, recall: 0.5 });
    expect(s.accuracy.spam.gemini.precision).toBeNull();
  });

  it("renders a report naming both models", () => {
    const report = formatReport(s, { gemini: "gemini-3.6-flash", jev: "jev-1.13.0" });
    expect(report).toContain("Gemini (gemini-3.6-flash) vs Jev (jev-1.13.0) — 4 items, 3 answered by both");
    expect(report).toContain("toxic");
    expect(report).not.toContain("spam   gemini"); // no spam labels → no spam accuracy row
  });

  it("handles an empty run", () => {
    const empty = summarize([], DEFAULT_RULES);
    expect(empty.latency.jev.meanMs).toBeNull();
    expect(empty.agreement.toxicityAction).toBeNull();
    expect(() => formatReport(empty, { gemini: "g", jev: "j" })).not.toThrow();
  });
});

describe("helpers", () => {
  it("percentile uses nearest rank", () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(percentile([7], 50)).toBe(7);
  });

  it("toxicityAction mirrors the app's thresholds", () => {
    expect(toxicityAction(scores(0.85), DEFAULT_RULES)).toBe("remove");
    expect(toxicityAction(scores(0.6), DEFAULT_RULES)).toBe("flag");
    expect(toxicityAction(scores(0.59), DEFAULT_RULES)).toBe("none");
  });
});
