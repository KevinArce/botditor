import { describe, it, expect, vi } from "vitest";
import type { SettingsClient, TriggerContext } from "@devvit/public-api";
import { createSettingsSnapshot, withSettingsSnapshot } from "../settingsSnapshot.js";

function createMockSettings(values: Record<string, unknown>): SettingsClient {
  return {
    get: vi.fn(async (key: string) => values[key]),
    getAll: vi.fn(async () => values),
  } as unknown as SettingsClient;
}

describe("createSettingsSnapshot (PERF-1)", () => {
  it("serves every get() from a single getAll() call", async () => {
    const settings = createMockSettings({ a: 1, b: "two", c: true });
    const snapshot = createSettingsSnapshot(settings);

    const values = await Promise.all([
      snapshot.get("a"),
      snapshot.get("b"),
      snapshot.get("c"),
      snapshot.get("missing"),
    ]);

    expect(values).toEqual([1, "two", true, undefined]);
    expect(settings.getAll).toHaveBeenCalledTimes(1);
    expect(settings.get).not.toHaveBeenCalled();
  });

  it("retries after a failed fetch instead of caching the error", async () => {
    const settings = createMockSettings({ a: 1 });
    vi.mocked(settings.getAll).mockRejectedValueOnce(new Error("RPC down"));
    const snapshot = createSettingsSnapshot(settings);

    await expect(snapshot.get("a")).rejects.toThrow("RPC down");
    await expect(snapshot.get("a")).resolves.toBe(1);
    expect(settings.getAll).toHaveBeenCalledTimes(2);
  });
});

describe("withSettingsSnapshot", () => {
  it("overrides settings and keeps every other client", async () => {
    const redis = { get: vi.fn() };
    const context = {
      redis,
      settings: createMockSettings({ a: 1 }),
    } as unknown as TriggerContext;

    const wrapped = withSettingsSnapshot(context);

    expect(wrapped.redis).toBe(redis);
    expect(wrapped.settings).not.toBe(context.settings);
    await expect(wrapped.settings.get("a")).resolves.toBe(1);
  });

  it("does not evaluate the original context's lazy getters", () => {
    const getter = vi.fn(() => {
      throw new Error("ui is unavailable in triggers");
    });
    const context = {
      settings: createMockSettings({}),
      get ui() {
        return getter();
      },
    } as unknown as TriggerContext;

    withSettingsSnapshot(context);
    expect(getter).not.toHaveBeenCalled();
  });
});
