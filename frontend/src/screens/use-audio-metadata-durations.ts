import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import type { Episode } from "@/lib/api";

type EpisodeDurationSource = Pick<Episode, "id" | "duration"> & {
  type?: "episode" | "audiobook";
  audioUrl?: string;
};

const MAX_CONCURRENT_PROBES = 2;

function isPositiveDuration(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readDuration(audio: HTMLAudioElement) {
  return isPositiveDuration(audio.duration) ? Math.round(audio.duration) : null;
}

function getItemKey(item: {
  type?: "episode" | "audiobook";
  id: number;
}): string {
  return `${item.type || "episode"}:${item.id}`;
}

function resolveAudioUrl(item: {
  type?: "episode" | "audiobook";
  id: number;
  audioUrl?: string;
}): string | null {
  if (item.type === "audiobook") {
    return item.audioUrl || null;
  }
  return `/api/episodes/${item.id}/audio`;
}

interface ProbeItem {
  key: string;
  type: "episode" | "audiobook";
  id: number;
  audioUrl?: string;
  url: string;
}

interface ActiveProbe {
  audio: HTMLAudioElement;
  cleanup: () => void;
}

// Module-level in-memory tab state
const durationCache = new Map<string, number>();
const failedKeys = new Set<string>();
const activeProbes = new Map<string, ActiveProbe>();
const probeQueue: ProbeItem[] = [];
const probeQueueKeys = new Set<string>();

// Consumers registration
const consumersByKey = new Map<string, Set<symbol>>();
const consumerSubscribedKeys = new Map<symbol, Set<string>>();

let cacheVersion = 0;
const listeners = new Set<() => void>();

function notifyUpdate() {
  cacheVersion++;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot() {
  return cacheVersion;
}

function pumpQueue() {
  if (typeof Audio === "undefined") {
    return;
  }

  while (activeProbes.size < MAX_CONCURRENT_PROBES && probeQueue.length > 0) {
    const item = probeQueue.shift()!;
    probeQueueKeys.delete(item.key);

    if (
      durationCache.has(item.key) ||
      activeProbes.has(item.key) ||
      failedKeys.has(item.key)
    ) {
      continue;
    }

    const consumers = consumersByKey.get(item.key);
    if (!consumers || consumers.size === 0) {
      continue;
    }

    startProbe(item);
  }
}

function startProbe(item: ProbeItem) {
  const audio = new Audio();
  let settled = false;

  const cleanupListeners = () => {
    audio.removeEventListener("loadedmetadata", handleLoaded);
    audio.removeEventListener("durationchange", handleLoaded);
    audio.removeEventListener("error", handleError);
    try {
      audio.pause();
      audio.src = "";
    } catch {
      // ignore
    }
  };

  const finish = (duration: number | null) => {
    if (settled) return;
    settled = true;

    cleanupListeners();
    activeProbes.delete(item.key);

    if (isPositiveDuration(duration)) {
      durationCache.set(item.key, duration);
      notifyUpdate();
    } else {
      failedKeys.add(item.key);
    }

    pumpQueue();
  };

  const handleLoaded = () => {
    const nextDuration = readDuration(audio);
    if (!nextDuration) {
      return;
    }
    finish(nextDuration);
  };

  const handleError = () => {
    finish(null);
  };

  try {
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("durationchange", handleLoaded);
    audio.addEventListener("error", handleError);
    audio.src = item.url;
  } catch {
    finish(null);
    return;
  }

  activeProbes.set(item.key, {
    audio,
    cleanup: () => {
      if (settled) return;
      settled = true;
      cleanupListeners();
    },
  });
}

function updateConsumerSubscriptions(consumerId: symbol, items: ProbeItem[]) {
  const prevKeys = consumerSubscribedKeys.get(consumerId) ?? new Set<string>();
  const nextKeys = new Set(items.map((item) => item.key));
  consumerSubscribedKeys.set(consumerId, nextKeys);

  for (const key of prevKeys) {
    if (!nextKeys.has(key)) {
      const consumers = consumersByKey.get(key);
      if (consumers) {
        consumers.delete(consumerId);
        if (consumers.size === 0) {
          consumersByKey.delete(key);
          failedKeys.delete(key);

          const qIdx = probeQueue.findIndex((item) => item.key === key);
          if (qIdx !== -1) {
            probeQueue.splice(qIdx, 1);
            probeQueueKeys.delete(key);
          }

          const active = activeProbes.get(key);
          if (active) {
            active.cleanup();
            activeProbes.delete(key);
          }
        }
      }
    }
  }

  for (const item of items) {
    let consumers = consumersByKey.get(item.key);
    if (!consumers) {
      consumers = new Set();
      consumersByKey.set(item.key, consumers);
    }
    consumers.add(consumerId);

    if (
      !durationCache.has(item.key) &&
      !activeProbes.has(item.key) &&
      !failedKeys.has(item.key) &&
      !probeQueueKeys.has(item.key)
    ) {
      probeQueue.push(item);
      probeQueueKeys.add(item.key);
    }
  }

  pumpQueue();
}

function removeConsumerSubscriptions(consumerId: symbol) {
  const keys = consumerSubscribedKeys.get(consumerId);
  if (!keys) return;
  consumerSubscribedKeys.delete(consumerId);

  let freedSlot = false;

  for (const key of keys) {
    const consumers = consumersByKey.get(key);
    if (consumers) {
      consumers.delete(consumerId);
      if (consumers.size === 0) {
        consumersByKey.delete(key);
        failedKeys.delete(key);

        const qIdx = probeQueue.findIndex((item) => item.key === key);
        if (qIdx !== -1) {
          probeQueue.splice(qIdx, 1);
          probeQueueKeys.delete(key);
        }

        const active = activeProbes.get(key);
        if (active) {
          active.cleanup();
          activeProbes.delete(key);
          freedSlot = true;
        }
      }
    }
  }

  if (freedSlot) {
    pumpQueue();
  }
}

export function resetAudioMetadataQueueForTesting() {
  for (const probe of activeProbes.values()) {
    probe.cleanup();
  }
  activeProbes.clear();
  probeQueue.length = 0;
  probeQueueKeys.clear();
  durationCache.clear();
  failedKeys.clear();
  consumersByKey.clear();
  consumerSubscribedKeys.clear();
  listeners.clear();
  cacheVersion = 0;
}

export function useAudioMetadataDurations(
  episodes: EpisodeDurationSource[]
) {
  const version = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const instanceIdRef = useRef<symbol | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = Symbol("useAudioMetadataDurations");
  }

  const missingItems = useMemo<ProbeItem[]>(() => {
    void version;
    return episodes
      .filter((episode) => {
        if (isPositiveDuration(episode.duration)) {
          return false;
        }
        const key = getItemKey(episode);
        return !durationCache.has(key);
      })
      .map((episode) => {
        const type = episode.type || "episode";
        const key = getItemKey(episode);
        const url = resolveAudioUrl(episode);
        return {
          key,
          type,
          id: episode.id,
          audioUrl: episode.audioUrl,
          url: url || "",
        };
      })
      .filter((item) => Boolean(item.url));
  }, [episodes, version]);

  const subscribedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof Audio === "undefined") {
      return;
    }

    const currentKeys = new Set(missingItems.map((item) => item.key));
    const prevKeys = subscribedKeysRef.current;

    let isSame = currentKeys.size === prevKeys.size;
    if (isSame) {
      for (const k of currentKeys) {
        if (!prevKeys.has(k)) {
          isSame = false;
          break;
        }
      }
    }

    if (isSame) {
      return;
    }

    subscribedKeysRef.current = currentKeys;
    const id = instanceIdRef.current!;
    updateConsumerSubscriptions(id, missingItems);
  }, [missingItems]);

  useEffect(
    () => () => {
      const id = instanceIdRef.current;
      if (id) {
        removeConsumerSubscriptions(id);
      }
    },
    []
  );

  return useCallback(
    (episode: EpisodeDurationSource) => {
      void version;
      if (isPositiveDuration(episode.duration)) {
        return episode.duration;
      }
      const key = getItemKey(episode);
      return durationCache.get(key) ?? null;
    },
    [version]
  );
}
