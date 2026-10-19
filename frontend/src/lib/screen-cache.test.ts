import { beforeEach, describe, expect, it } from "vitest";

import {
  clearCachedAudiobooks,
  clearCachedSettings,
  getCachedAudiobooks,
  getCachedSettings,
  setCachedAudiobooks,
  setCachedSettings,
  updateCachedSettings,
} from "./screen-cache";

describe("screen-cache", () => {
  beforeEach(() => {
    clearCachedAudiobooks();
    clearCachedSettings();
  });

  it("stores and clears audiobooks cache", () => {
    expect(getCachedAudiobooks()).toBeNull();
    const books = [
      {
        id: 1,
        title: "Test Book",
        author: "Author",
        duration: 100,
        hasCover: false,
        files: [],
      },
    ];
    setCachedAudiobooks(books);
    expect(getCachedAudiobooks()).toEqual(books);
    clearCachedAudiobooks();
    expect(getCachedAudiobooks()).toBeNull();
  });

  it("stores, updates, and clears settings cache", () => {
    expect(getCachedSettings()).toBeNull();
    const cache = {
      settings: {
        dailyRefreshTime: "03:00",
        proxyConfigured: false,
        proxyEnabled: false,
      },
      scheduler: {
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
      },
      proxyStatus: null,
      dailyRefreshTime: "03:00",
    };
    setCachedSettings(cache);
    expect(getCachedSettings()).toEqual(cache);

    updateCachedSettings({ dailyRefreshTime: "05:00" });
    expect(getCachedSettings()?.dailyRefreshTime).toBe("05:00");

    clearCachedSettings();
    expect(getCachedSettings()).toBeNull();
  });
});
