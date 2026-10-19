/**
 * Per-trigger settings snapshot (PERF-1).
 *
 * In Devvit 0.12, every `settings.get(name)` calls `getAll()` internally — a
 * full settings RPC to the plugin — and then picks one value. One comment
 * reads ~15 settings across the pipeline, so this wrapper fetches them once
 * and serves every later `get()` from that single result.
 */
import type { SettingsClient, SettingsValues, TriggerContext } from "@devvit/public-api";

/**
 * Wrap a `SettingsClient` so all reads share one `getAll()` call. A failed
 * fetch is not cached, so the next read retries.
 */
export function createSettingsSnapshot(settings: SettingsClient): SettingsClient {
  let pending: Promise<SettingsValues> | undefined;

  const load = (): Promise<SettingsValues> => {
    pending ??= settings.getAll<SettingsValues>().catch((err: unknown) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };

  return {
    get: async <T>(name: string) => (await load())[name] as T | undefined,
    getAll: async <T extends object>() => (await load()) as T,
  } as SettingsClient;
}

/**
 * Return a context whose `settings` reads from one snapshot. The original
 * context stays the prototype, so every other client (and Devvit's lazy
 * getters) behave exactly as before.
 */
export function withSettingsSnapshot<T extends TriggerContext>(context: T): T {
  return Object.create(context, {
    settings: { value: createSettingsSnapshot(context.settings) },
  }) as T;
}
