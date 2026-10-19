/// <reference types="node" />
/**
 * `npm run bench` — score a local corpus with Gemini and TypeSafe Jev and
 * compare them under the app's default thresholds.
 *
 *   npm run bench                         # bench/corpus.example.jsonl
 *   npm run bench -- path/to/corpus.jsonl --concurrency 4
 *
 * Keys come from the environment (`.env` is loaded by the npm script):
 *   GEMINI_API_KEY (required) · JEV_API_KEY (required)
 *   GEMINI_MODEL (default: the app's) · JEV_MODEL (default jev-1.13.0)
 *
 * Results are written to bench/results/<timestamp>.json (git-ignored).
 * Runs on your machine only; it is not part of the Devvit app.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_GEMINI_MODEL, DEFAULT_JEV_MODEL, DEFAULT_RULES } from "../src/types.js";
import { requestGeminiAnalysis } from "../src/ai.js";
import { requestJevAnalysis } from "../src/jev.js";
import { formatReport, parseCorpus, runBenchmark, summarize } from "./benchmark.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    concurrency: { type: "string", default: "2" },
    out: { type: "string", default: "bench/results" },
  },
});

const corpusPath = positionals[0] ?? "bench/corpus.example.jsonl";
const concurrency = Number.parseInt(values.concurrency, 10);
if (!Number.isInteger(concurrency) || concurrency < 1) {
  fail("--concurrency must be a positive integer");
}

const geminiKey = process.env.GEMINI_API_KEY?.trim();
const jevKey = process.env.JEV_API_KEY?.trim();
if (!geminiKey || !jevKey) {
  fail("Set GEMINI_API_KEY and JEV_API_KEY (e.g. in .env) before running the benchmark.");
}
const geminiModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
const jevModel = process.env.JEV_MODEL?.trim() || DEFAULT_JEV_MODEL;

const items = parseCorpus(readFileSync(corpusPath, "utf8"));
console.log(`Benchmarking ${items.length} items from ${corpusPath} (concurrency ${concurrency})…`);

const rows = await runBenchmark(
  items,
  {
    gemini: (item) =>
      requestGeminiAnalysis(item.text, { apiKey: geminiKey, model: geminiModel }, `item ${item.id}`),
    jev: (item) =>
      requestJevAnalysis(
        { text: item.text, subreddit: item.subreddit },
        { apiKey: jevKey, model: jevModel },
        `item ${item.id}`
      ),
  },
  { concurrency }
);

const summary = summarize(rows, DEFAULT_RULES);
const report = formatReport(summary, { gemini: geminiModel, jev: jevModel });

mkdirSync(values.out, { recursive: true });
const outFile = join(values.out, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(
  outFile,
  JSON.stringify(
    { corpus: corpusPath, models: { gemini: geminiModel, jev: jevModel }, rules: DEFAULT_RULES, summary, rows },
    null,
    2
  )
);

console.log(`\n${report}\n\nFull results: ${outFile}`);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
