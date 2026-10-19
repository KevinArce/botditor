import { describe, it, expect, vi } from "vitest";
import { Devvit } from "@devvit/public-api";
import { GEMINI_API_HOST, DEFAULT_JEV_API_HOST } from "../types.js";

// Capture the app's registration calls without touching the Devvit runtime.
const configure = vi.spyOn(Devvit, "configure").mockImplementation(() => {});
vi.spyOn(Devvit, "addSettings").mockImplementation(() => {});
vi.spyOn(Devvit, "addTrigger").mockImplementation(() => Devvit);
vi.spyOn(Devvit, "addMenuItem").mockImplementation(() => {});
vi.spyOn(Devvit, "createForm").mockImplementation(() => ({}) as never);
await import("../main.js");

describe("Devvit.configure (fetch domains)", () => {
  const config = configure.mock.calls[0][0] as { http: { domains: string[] } };

  it("requests the Gemini API domain", () => {
    expect(config.http.domains).toContain(GEMINI_API_HOST);
  });

  it("never requests the TypeSafe domain — Devvit allows only OpenAI and Gemini (POL-3)", () => {
    expect(config.http.domains).not.toContain(DEFAULT_JEV_API_HOST);
    expect(config.http.domains).toEqual([GEMINI_API_HOST]);
  });
});
