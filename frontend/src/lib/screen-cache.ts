import type {
  Audiobook,
  ProxyRuntimeStatus,
  SchedulerStatus,
  SettingsValues,
} from "@/lib/api";

export type SettingsMemoryCache = {
  settings: SettingsValues;
  scheduler: SchedulerStatus | null;
  proxyStatus: ProxyRuntimeStatus | null;
  dailyRefreshTime: string;
};

let audiobooksMemoryCache: Audiobook[] | null = null;
let settingsMemoryCache: SettingsMemoryCache | null = null;
let schedulerMemoryCache: SchedulerStatus | null = null;

export function getCachedAudiobooks(): Audiobook[] | null {
  return audiobooksMemoryCache;
}

export function setCachedAudiobooks(books: Audiobook[]): void {
  audiobooksMemoryCache = books;
}

export function clearCachedAudiobooks(): void {
  audiobooksMemoryCache = null;
}

export function getCachedScheduler(): SchedulerStatus | null {
  return schedulerMemoryCache;
}

export function setCachedScheduler(status: SchedulerStatus | null): void {
  schedulerMemoryCache = status;
}

export function clearCachedScheduler(): void {
  schedulerMemoryCache = null;
}

export function getCachedSettings(): SettingsMemoryCache | null {
  return settingsMemoryCache;
}

export function setCachedSettings(cache: SettingsMemoryCache): void {
  settingsMemoryCache = cache;
}

export function updateCachedSettings(patch: Partial<SettingsMemoryCache>): void {
  if (settingsMemoryCache) {
    settingsMemoryCache = { ...settingsMemoryCache, ...patch };
  } else if (patch.settings && patch.dailyRefreshTime) {
    settingsMemoryCache = {
      settings: patch.settings,
      scheduler: patch.scheduler ?? null,
      dailyRefreshTime: patch.dailyRefreshTime,
      proxyStatus: patch.proxyStatus ?? null,
    };
  }
}

export function clearCachedSettings(): void {
  settingsMemoryCache = null;
  schedulerMemoryCache = null;
}
