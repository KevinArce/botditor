import { describe, it, expect, vi } from "vitest";
import type { SettingsClient } from "@devvit/public-api";
import {
  loadModerationRules,
  logActiveRules,
  validateThresholdPair,
  validateProfile,
} from "../rules.js";
import { SETTINGS, DEFAULT_RULES } from "../types.js";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockSettings(
  values: Record<string, string | number | boolean | undefined> = {}
): SettingsClient {
  return {
    get: vi.fn(async <T>(key: string) => {
      return key in values ? (values[key] as T) : undefined;
    }),
    getAll: vi.fn(async () => values),
  } as unknown as SettingsClient;
}

// ---------------------------------------------------------------------------
// loadModerationRules
// ---------------------------------------------------------------------------

describe("loadModerationRules", () => {
  it("returns defaults when no settings are configured", async () => {
    const settings = createMockSettings({});
    const rules = await loadModerationRules(settings);

    expect(rules.enabled).toBe(true);
    expect(rules.dryRun).toBe(false);
    expect(rules.moderationProfile).toBe("chill");
    expect(rules.toxicityRemoveThreshold).toBe(0.85);
    expect(rules.toxicityFlagThreshold).toBe(0.60);
    expect(rules.spamRemoveThreshold).toBe(0.80);
    expect(rules.spamFlagThreshold).toBe(0.50);
    expect(rules.spamMode).toBe("flag");
    expect(rules.botFlagThreshold).toBe(0.75);
  });

  it("reads custom values from settings", async () => {
    const settings = createMockSettings({
      [SETTINGS.ENABLED]: false,
      [SETTINGS.DRY_RUN]: true,
      [SETTINGS.MODERATION_PROFILE]: "strict",
      [SETTINGS.TOXICITY_REMOVE_THRESHOLD]: 0.70,
      [SETTINGS.TOXICITY_FLAG_THRESHOLD]: 0.40,
      [SETTINGS.SPAM_REMOVE_THRESHOLD]: 0.60,
      [SETTINGS.SPAM_FLAG_THRESHOLD]: 0.30,
      [SETTINGS.SPAM_MODE]: "remove",
      [SETTINGS.BOT_FLAG_THRESHOLD]: 0.50,
    });
    const rules = await loadModerationRules(settings);

    expect(rules.enabled).toBe(false);
    expect(rules.dryRun).toBe(true);
    expect(rules.moderationProfile).toBe("strict");
    expect(rules.toxicityRemoveThreshold).toBe(0.70);
    expect(rules.toxicityFlagThreshold).toBe(0.40);
    expect(rules.spamRemoveThreshold).toBe(0.60);
    expect(rules.spamFlagThreshold).toBe(0.30);
    expect(rules.spamMode).toBe("remove");
    expect(rules.botFlagThreshold).toBe(0.50);
  });

  it("clamps toxicity flag threshold when remove < flag", async () => {
    const settings = createMockSettings({
      [SETTINGS.TOXICITY_REMOVE_THRESHOLD]: 0.50,
      [SETTINGS.TOXICITY_FLAG_THRESHOLD]: 0.80, // higher than remove — invalid
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rules = await loadModerationRules(settings);

    // Flag should be clamped down to remove threshold
    expect(rules.toxicityFlagThreshold).toBe(0.50);
    expect(rules.toxicityRemoveThreshold).toBe(0.50);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("toxicity: remove threshold (0.5) is lower than flag threshold (0.8)")
    );

    warnSpy.mockRestore();
  });

  it("clamps spam flag threshold when remove < flag", async () => {
    const settings = createMockSettings({
      [SETTINGS.SPAM_REMOVE_THRESHOLD]: 0.40,
      [SETTINGS.SPAM_FLAG_THRESHOLD]: 0.70, // higher — invalid
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rules = await loadModerationRules(settings);

    expect(rules.spamFlagThreshold).toBe(0.40);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("spam: remove threshold (0.4) is lower than flag threshold (0.7)")
    );

    warnSpy.mockRestore();
  });

  it("falls back to DEFAULT_RULES on settings read error", async () => {
    const settings = {
      get: vi.fn().mockRejectedValue(new Error("settings unavailable")),
      getAll: vi.fn().mockRejectedValue(new Error("settings unavailable")),
    } as unknown as SettingsClient;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const rules = await loadModerationRules(settings);

    expect(rules).toEqual(DEFAULT_RULES);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load moderation settings"),
      expect.any(String)
    );

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// logActiveRules
// ---------------------------------------------------------------------------

describe("logActiveRules", () => {
  it("logs all thresholds without throwing", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    logActiveRules({ ...DEFAULT_RULES });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[rules] Active moderation rules:")
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("enabled=true")
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("dryRun=false")
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("profile=chill")
    );

    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// validateThresholdPair
// ---------------------------------------------------------------------------

describe("validateThresholdPair", () => {
  it("returns flag threshold unchanged when remove >= flag", () => {
    expect(validateThresholdPair("test", 0.85, 0.60)).toBe(0.60);
  });

  it("returns flag threshold unchanged when remove == flag", () => {
    expect(validateThresholdPair("test", 0.50, 0.50)).toBe(0.50);
  });

  it("clamps flag to remove when remove < flag", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(validateThresholdPair("test", 0.40, 0.70)).toBe(0.40);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// validateProfile
// ---------------------------------------------------------------------------

describe("validateProfile", () => {
  it("accepts 'strict'", () => {
    expect(validateProfile("strict")).toBe("strict");
  });

  it("accepts 'chill'", () => {
    expect(validateProfile("chill")).toBe("chill");
  });

  it("normalizes case", () => {
    expect(validateProfile("STRICT")).toBe("strict");
    expect(validateProfile("Chill")).toBe("chill");
  });

  it("falls back to 'chill' for unknown values", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(validateProfile("unknown")).toBe("chill");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown moderation profile")
    );
    warnSpy.mockRestore();
  });
});
