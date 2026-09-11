import { describe, it, expect, vi } from "vitest";
import { Devvit, SettingScope } from "@devvit/public-api";
import { SETTINGS, DEFAULT_GEMINI_MODEL } from "../types.js";

type RegisteredField = { name?: string; defaultValue?: unknown; scope?: unknown };

describe("settings registration", () => {
  it("registers DEFAULT_GEMINI_MODEL as the geminiModel default", async () => {
    // Devvit returns a setting's registered default whenever it is unset, so
    // this default — not the fallback in ai.ts — is what production uses.
    const addSettings = vi
      .spyOn(Devvit, "addSettings")
      .mockImplementation(() => {});

    await import("../settings.js");

    const fields = addSettings.mock.calls[0][0] as RegisteredField[];
    const model = fields.find((f) => f.name === SETTINGS.GEMINI_MODEL);
    expect(model?.defaultValue).toBe(DEFAULT_GEMINI_MODEL);
    expect(model?.scope).toBe(SettingScope.App);
  });
});
