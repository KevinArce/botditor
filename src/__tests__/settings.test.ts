import { describe, it, expect, vi } from "vitest";
import { Devvit, SettingScope } from "@devvit/public-api";
import { SETTINGS, DEFAULT_GEMINI_MODEL } from "../types.js";

type Validator = (event: { value: unknown; isEditing: boolean }, context: unknown) => unknown;
type RegisteredField = {
  name?: string;
  defaultValue?: unknown;
  scope?: unknown;
  onValidate?: Validator;
};

// Devvit returns a setting's registered default whenever it is unset, so
// these defaults — not fallbacks elsewhere — are what production uses.
const addSettings = vi.spyOn(Devvit, "addSettings").mockImplementation(() => {});
await import("../settings.js");
const fields = addSettings.mock.calls[0][0] as RegisteredField[];
const field = (name: string) => fields.find((f) => f.name === name)!;
const validate = (name: string, value: unknown) =>
  field(name).onValidate?.({ value, isEditing: true }, {});

describe("settings registration", () => {
  it("registers DEFAULT_GEMINI_MODEL as the geminiModel default", () => {
    const model = field(SETTINGS.GEMINI_MODEL);
    expect(model.defaultValue).toBe(DEFAULT_GEMINI_MODEL);
    expect(model.scope).toBe(SettingScope.App);
  });

  it("registers no TypeSafe Jev settings — Jev is benchmarked offline only (POL-3)", () => {
    const names = fields.map((f) => f.name ?? "");
    expect(names.filter((n) => /jev|aiprovider/i.test(n))).toEqual([]);
  });
});

describe("settings validation (COR-2)", () => {
  const thresholds = [
    SETTINGS.TOXICITY_REMOVE_THRESHOLD,
    SETTINGS.TOXICITY_FLAG_THRESHOLD,
    SETTINGS.SPAM_REMOVE_THRESHOLD,
    SETTINGS.SPAM_FLAG_THRESHOLD,
    SETTINGS.BOT_FLAG_THRESHOLD,
  ];

  it.each(thresholds)("%s rejects 0, negatives, and values above 1", (name) => {
    expect(validate(name, 0)).toEqual(expect.any(String));
    expect(validate(name, -0.5)).toEqual(expect.any(String));
    expect(validate(name, 1.01)).toEqual(expect.any(String));
  });

  it.each(thresholds)("%s accepts values in (0, 1] and an empty field", (name) => {
    expect(validate(name, 0.5)).toBeUndefined();
    expect(validate(name, 1)).toBeUndefined();
    expect(validate(name, undefined)).toBeUndefined();
  });

  it.each([
    [SETTINGS.SPAM_MODE, "remove", "delete"],
    [SETTINGS.MODERATION_PROFILE, "Strict", "comedy"],
  ])("%s accepts %j and rejects %j", (name, good, bad) => {
    expect(validate(name, good)).toBeUndefined();
    expect(validate(name, bad)).toEqual(expect.stringContaining("Must be one of"));
  });
});
