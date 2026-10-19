import type {
  Audiobook,
  ProxyRuntimeStatus,
  SchedulerStatus,
  SettingsValues,
} from "@/lib/api";

export type SettingsMemoryCache = {
  settings: SettingsValues;
  scheduler: SchedulerStatus;
  proxyStatus: ProxyRuntimeStatus | null;
  dailyRefreshTime: string;
};

let audiobooksMemoryCache: Audiobook[] | null = null;
let settingsMemoryCache: SettingsMemoryCache | null = null;

export function getCachedAudiobooks(): Audiobook[] | null {
  return audiobooksMemoryCache;
}

export function setCachedAudiobooks(books: Audiobook[]): void {
  audiobooksMemoryCache = books;
}

export function clearCachedAudiobooks(): void {
  audiobooksMemoryCache = null;
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
  }
}

export function clearCachedSettings(): void {
  settingsMemoryCache = null;
}
