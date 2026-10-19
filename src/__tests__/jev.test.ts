import { describe, it, expect, vi, afterEach } from "vitest";
import {
  requestJevAnalysis,
  buildJevRequestBody,
  parseJevResponse,
  composeReason,
  isJevFailure,
  JEV_QUESTIONS,
} from "../jev.js";
import { ANALYSIS_FALLBACK, DEFAULT_JEV_MODEL, MAX_PROMPT_BODY_LENGTH } from "../types.js";

const CONFIG = { apiKey: "test-jev-key", model: "jev-1.13.0" };
const INPUT = { text: "This is a regular comment for testing Jev.", subreddit: "testsub" };

/**
 * Build a System One response body in the documented shape
 * (docs.typesafe.ai/api): an `answers` map keyed by our question IDs.
 */
function systemOneResponse(a: {
  toxic: number;
  spam: number;
  bot: number;
  sentiment: string;
}): string {
  return JSON.stringify({
    model: "jev-1.13.0",
    answers: {
      toxic: { type: "noul", noul: a.toxic },
      spam: { type: "noul", noul: a.spam },
      bot: { type: "noul", noul: a.bot },
      sentiment: {
        type: "choice",
        choice: a.sentiment,
        probabilities: { positive: 0, neutral: 0, negative: 0, [a.sentiment]: 1 },
        confidence: 0.9,
      },
    },
    usage: { input_tokens: 300, output_tokens: 8 },
  });
}

// ---------------------------------------------------------------------------
// Tests – buildJevRequestBody
// ---------------------------------------------------------------------------

describe("buildJevRequestBody", () => {
  it("builds a System One request: model, state, and questions", () => {
    const body = buildJevRequestBody({ text: "Hello world", subreddit: "science" }, "jev-1.13.0") as {
      model: string;
      state: { comment: { text: string; subreddit: string } };
      questions: Record<string, { type: string }>;
    };

    expect(body.model).toBe("jev-1.13.0");
    expect(body.state).toEqual({ comment: { text: "Hello world", subreddit: "science" } });
    expect(body.questions).toBe(JEV_QUESTIONS);
    expect(body.questions.toxic.type).toBe("noul");
    expect(body.questions.spam.type).toBe("noul");
    expect(body.questions.bot.type).toBe("noul");
    expect(body.questions.sentiment.type).toBe("choice");
  });

  it("sends only the text and subreddit — no usernames or IDs", () => {
    const body = buildJevRequestBody(INPUT, "jev-1.13.0") as { state: unknown };
    expect(body.state).toEqual({ comment: INPUT });
  });

  it("truncates long text like the Gemini prompt", () => {
    const body = buildJevRequestBody(
      { text: "x".repeat(MAX_PROMPT_BODY_LENGTH + 100), subreddit: "s" },
      "jev-1.13.0"
    ) as { state: { comment: { text: string } } };

    expect(body.state.comment.text).toBe("x".repeat(MAX_PROMPT_BODY_LENGTH) + " [truncated]");
  });

  it("defines all sentiment options the parser accepts", () => {
    expect(Object.keys(JEV_QUESTIONS.sentiment.criteria).sort()).toEqual(
      ["negative", "neutral", "positive"]
    );
  });

  it("pins a versioned default model rather than an alias", () => {
    expect(DEFAULT_JEV_MODEL).toMatch(/^jev-\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// Tests – parseJevResponse
// ---------------------------------------------------------------------------

describe("parseJevResponse", () => {
  it("maps noul and choice answers onto an AnalysisResult", () => {
    const result = parseJevResponse(
      systemOneResponse({ toxic: 0.92, spam: 0.05, bot: 0.1, sentiment: "negative" })
    );
    expect(result).toEqual({
      toxicityScore: 0.92,
      spamScore: 0.05,
      botLikelihood: 0.1,
      sentiment: "negative",
      reason: "likely insulting, hateful or harassing language",
    });
  });

  it("composes the reason from the strongest signal", () => {
    const result = parseJevResponse(
      systemOneResponse({ toxic: 0.1, spam: 0.85, bot: 0.6, sentiment: "neutral" })
    );
    expect(result.reason).toBe("likely spam or unsolicited promotion");
  });

  it("clamps probabilities out of [0, 1] range", () => {
    const result = parseJevResponse(
      systemOneResponse({ toxic: 1.5, spam: -0.2, bot: 0.5, sentiment: "positive" })
    );
    expect(result.toxicityScore).toBe(1);
    expect(result.spamScore).toBe(0);
    expect(result.botLikelihood).toBe(0.5);
  });

  it("returns parse error fallback on invalid JSON", () => {
    const result = parseJevResponse("not a json");
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "parse error" });
  });

  it("returns parse error fallback when the answers map is missing", () => {
    const result = parseJevResponse(JSON.stringify({ toxicityScore: 0.5 }));
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "parse error" });
  });

  it("returns parse error fallback when an answer is missing", () => {
    const payload = JSON.parse(
      systemOneResponse({ toxic: 0.1, spam: 0.1, bot: 0.1, sentiment: "neutral" })
    );
    delete payload.answers.bot;
    const result = parseJevResponse(JSON.stringify(payload));
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "parse error" });
  });

  it("returns parse error fallback when an answer has the wrong type", () => {
    const payload = JSON.parse(
      systemOneResponse({ toxic: 0.1, spam: 0.1, bot: 0.1, sentiment: "neutral" })
    );
    payload.answers.toxic = { type: "score", score: 1.2 };
    const result = parseJevResponse(JSON.stringify(payload));
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "parse error" });
  });

  it("returns parse error fallback when sentiment is invalid", () => {
    const result = parseJevResponse(
      systemOneResponse({ toxic: 0.1, spam: 0.1, bot: 0.1, sentiment: "angry" })
    );
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "parse error" });
  });
});

// ---------------------------------------------------------------------------
// Tests – composeReason / isJevFailure
// ---------------------------------------------------------------------------

describe("composeReason", () => {
  it("reports no concern when every signal is below 0.5", () => {
    expect(composeReason(0.49, 0.2, 0.1)).toBe("no policy concern detected");
  });

  it("names the bot signal when it is strongest", () => {
    expect(composeReason(0.1, 0.2, 0.7)).toBe("likely automated or bot-like content");
  });
});

describe("isJevFailure", () => {
  it.each([
    "timeout or network error",
    "response read error",
    "parse error",
    "jev api error 401",
  ])("treats %s as a failure", (reason) => {
    expect(isJevFailure({ ...ANALYSIS_FALLBACK, reason })).toBe(true);
  });

  it.each([
    "likely insulting, hateful or harassing language",
    "no policy concern detected",
    "emoji-only comment",
  ])("treats %s as a real decision", (reason) => {
    expect(isJevFailure({ ...ANALYSIS_FALLBACK, reason })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests – requestJevAnalysis
// ---------------------------------------------------------------------------

describe("requestJevAnalysis", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs to the System One endpoint with a Bearer key and parses the answers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        systemOneResponse({ toxic: 0.88, spam: 0.05, bot: 0.12, sentiment: "negative" }),
    } as Response);
    globalThis.fetch = fetchMock;

    const result = await requestJevAnalysis(INPUT, CONFIG, "item t1");

    expect(result.toxicityScore).toBe(0.88);
    expect(result.sentiment).toBe("negative");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-jev-key",
        },
      })
    );
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.model).toBe("jev-1.13.0");
    expect(sent.state).toEqual({ comment: INPUT });
  });

  it("honours a custom host", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => systemOneResponse({ toxic: 0, spam: 0, bot: 0, sentiment: "neutral" }),
    } as Response);
    globalThis.fetch = fetchMock;

    await requestJevAnalysis(INPUT, { ...CONFIG, host: "staging.typesafe.ai" }, "item");
    expect(fetchMock.mock.calls[0][0]).toBe("https://staging.typesafe.ai/v1/systemone");
  });

  it("returns a failure fallback on HTTP errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    } as Response);

    const result = await requestJevAnalysis(INPUT, CONFIG, "item");
    expect(result).toEqual({ ...ANALYSIS_FALLBACK, reason: "jev api error 429" });
    expect(isJevFailure(result)).toBe(true);
  });

  it("returns a failure fallback on network errors without throwing", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const result = await requestJevAnalysis(INPUT, CONFIG, "item");
    expect(result.reason).toBe("timeout or network error");
    expect(isJevFailure(result)).toBe(true);
  });

  it("returns parse error on a malformed body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html>oops</html>",
    } as Response);

    const result = await requestJevAnalysis(INPUT, CONFIG, "item");
    expect(result.reason).toBe("parse error");
  });
});
