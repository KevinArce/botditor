/**
 * TypeSafe Jev client — offline benchmarking only.
 *
 * The published app never calls Jev: Devvit's fetch policy permits only
 * OpenAI and Google Gemini as AI providers, and domain requests are reviewed
 * for playtests too, so `api.typesafe.ai` is deliberately absent from
 * `Devvit.configure({ http })`. This module is imported only by the local
 * benchmark (`bench/`, `npm run bench`) and never bundled into the app.
 *
 * Contract (docs.typesafe.ai/api): `POST /v1/systemone` with `model`, a
 * `state` (the content to judge) and a `questions` map; the response carries
 * an `answers` map keyed by the same question IDs. Jev returns typed
 * judgments — a `noul` is the probability that a condition holds, a `choice`
 * picks one option — and never generates text, so the human-readable
 * `reason` is composed in code from the strongest signal.
 *
 * Design decisions:
 *   • Context-free: needs only `fetch`, so it runs in Node.
 *   • Never throws; failures return the zero-score fallback, and
 *     `isJevFailure()` tells them apart from real decisions.
 *   • Only the comment text and subreddit name are sent — no usernames or
 *     IDs (data minimisation for the third-party processor).
 */
import type { AnalysisResult } from "./types.js";
import {
  ANALYSIS_FALLBACK,
  DEFAULT_JEV_API_HOST,
  JEV_API_PATH,
  JEV_TIMEOUT_MS,
  MAX_PROMPT_BODY_LENGTH,
} from "./types.js";
import { withTimeout, validateScore, validateSentiment } from "./ai.js";

// ---------------------------------------------------------------------------
// Failure detection
// ---------------------------------------------------------------------------

/** `reason` values returned when Jev produced no decision. */
const JEV_FAILURE_REASONS = new Set([
  "timeout or network error",
  "response read error",
  "parse error",
]);

/**
 * True when `result` is a fallback from a failed Jev call rather than a
 * real decision. Reasons for real decisions are composed by
 * `composeReason()`, so they can never collide with these.
 */
export function isJevFailure(result: AnalysisResult): boolean {
  return (
    JEV_FAILURE_REASONS.has(result.reason) ||
    result.reason.startsWith("jev api error")
  );
}

// ---------------------------------------------------------------------------
// HTTP call
// ---------------------------------------------------------------------------

/** Credentials, host and model for one Jev call. */
export interface JevConfig {
  apiKey: string;
  model: string;
  /** Defaults to `DEFAULT_JEV_API_HOST`. */
  host?: string;
}

/** What Jev is asked to judge. */
export interface JevInput {
  text: string;
  subreddit: string;
}

/**
 * POST one comment to TypeSafe System One and parse the answers. Never
 * throws. `label` identifies the item in logs — never the comment text.
 */
export async function requestJevAnalysis(
  input: JevInput,
  { apiKey, model, host = DEFAULT_JEV_API_HOST }: JevConfig,
  label: string
): Promise<AnalysisResult> {
  const url = `https://${host}${JEV_API_PATH}`;

  let response: Response;
  try {
    response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(buildJevRequestBody(input, model)),
      }),
      JEV_TIMEOUT_MS
    );
  } catch (err) {
    console.error(
      `[jev] Request timed out or failed for ${label}:`,
      err instanceof Error ? err.message : err
    );
    return { ...ANALYSIS_FALLBACK, reason: "timeout or network error" };
  }

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      /* ignore */
    }
    console.error(
      `[jev] API returned status ${response.status} for ${label} (model=${model})`,
      errorBody ? `— body: ${errorBody.slice(0, 500)}` : ""
    );
    return { ...ANALYSIS_FALLBACK, reason: `jev api error ${response.status}` };
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch (err) {
    console.error(
      `[jev] Failed to read response body for ${label}:`,
      err instanceof Error ? err.message : err
    );
    return { ...ANALYSIS_FALLBACK, reason: "response read error" };
  }

  return parseJevResponse(responseText);
}

// ---------------------------------------------------------------------------
// Request construction & response parsing
// ---------------------------------------------------------------------------

/**
 * Question IDs sent to Jev. IDs are for code only and are not shown to the
 * model, so each question carries its full meaning in `instructions`.
 */
export const JEV_QUESTIONS = {
  toxic: {
    type: "noul",
    instructions:
      "Is `comment.text` insulting, hateful, harassing or threatening toward a person or group?",
    criteria: {
      true: "Insults, slurs, threats, or personal attacks on another user or a group",
      false: "Friendly, neutral, critical-but-civil, or light banter with no target",
    },
  },
  spam: {
    type: "noul",
    instructions:
      "Is `comment.text` spam: unsolicited advertising, self-promotion, scams, or promotional links unrelated to the discussion?",
    criteria: {
      true: "Advertising, referral or affiliate links, scams, or off-topic self-promotion",
      false: "A genuine contribution to the discussion, including relevant links",
    },
  },
  bot: {
    type: "noul",
    instructions:
      "Does `comment.text` read as automated or machine-generated rather than written by a person engaging with the discussion?",
    criteria: {
      true: "Templated, generic, or boilerplate text that ignores the thread, typical of bots",
      false: "Written by a person responding to the conversation",
    },
  },
  sentiment: {
    type: "choice",
    instructions: "What is the overall sentiment of `comment.text`?",
    criteria: {
      positive: "Approving, friendly, enthusiastic, or grateful",
      neutral: "Factual, mixed, or without clear emotional tone",
      negative: "Disapproving, angry, sad, or hostile",
    },
  },
} as const;

/**
 * Construct the System One request for a comment. The text is truncated
 * like the Gemini prompt; Jev's per-question limit is far above it.
 */
export function buildJevRequestBody(
  { text, subreddit }: JevInput,
  model: string
): Record<string, unknown> {
  const truncated =
    text.length > MAX_PROMPT_BODY_LENGTH
      ? text.slice(0, MAX_PROMPT_BODY_LENGTH) + " [truncated]"
      : text;

  return {
    model,
    state: { comment: { text: truncated, subreddit } },
    questions: JEV_QUESTIONS,
  };
}

/**
 * Parse and validate a System One response into an AnalysisResult.
 * Returns the fallback with reason "parse error" if any answer is missing
 * or malformed.
 */
export function parseJevResponse(rawText: string): AnalysisResult {
  try {
    const raw = JSON.parse(rawText) as { answers?: Record<string, unknown> };
    const answers = raw?.answers;
    if (!answers || typeof answers !== "object") {
      return { ...ANALYSIS_FALLBACK, reason: "parse error" };
    }

    const toxicityScore = validateScore(noulValue(answers.toxic));
    const spamScore = validateScore(noulValue(answers.spam));
    const botLikelihood = validateScore(noulValue(answers.bot));
    const sentiment = validateSentiment(choiceValue(answers.sentiment));

    if (
      toxicityScore === null ||
      spamScore === null ||
      botLikelihood === null ||
      sentiment === null
    ) {
      return { ...ANALYSIS_FALLBACK, reason: "parse error" };
    }

    return {
      toxicityScore,
      spamScore,
      botLikelihood,
      sentiment,
      reason: composeReason(toxicityScore, spamScore, botLikelihood),
    };
  } catch {
    return { ...ANALYSIS_FALLBACK, reason: "parse error" };
  }
}

/** Probability from a `noul` answer, or undefined if the shape is wrong. */
function noulValue(answer: unknown): unknown {
  if (!answer || typeof answer !== "object") return undefined;
  const a = answer as { type?: unknown; noul?: unknown };
  return a.type === "noul" ? a.noul : undefined;
}

/** Selected option from a `choice` answer, or undefined if malformed. */
function choiceValue(answer: unknown): unknown {
  if (!answer || typeof answer !== "object") return undefined;
  const a = answer as { type?: unknown; choice?: unknown };
  return a.type === "choice" ? a.choice : undefined;
}

/**
 * Build a short, user-safe reason from the strongest signal. It ends up in
 * report reasons and in the `{{issue}}` of warning PMs, so it describes the
 * concern in plain words rather than exposing raw probabilities.
 */
export function composeReason(
  toxicityScore: number,
  spamScore: number,
  botLikelihood: number
): string {
  const signals: Array<[number, string]> = [
    [toxicityScore, "insulting, hateful or harassing language"],
    [spamScore, "spam or unsolicited promotion"],
    [botLikelihood, "automated or bot-like content"],
  ];
  const [score, label] = signals.reduce((a, b) => (b[0] > a[0] ? b : a));
  return score >= 0.5 ? `likely ${label}` : "no policy concern detected";
}
