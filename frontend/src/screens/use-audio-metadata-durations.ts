import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Episode } from "@/lib/api";

type EpisodeDurationSource = Pick<Episode, "id" | "duration"> & {
  type?: "episode" | "audiobook";
  audioUrl?: string;
};

function isPositiveDuration(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readDuration(audio: HTMLAudioElement) {
  return isPositiveDuration(audio.duration) ? Math.round(audio.duration) : null;
}

export function useAudioMetadataDurations(
  episodes: EpisodeDurationSource[]
) {
  const [durationsByKey, setDurationsByKey] = useState<
    Record<string, number>
  >({});
  const audioProbesRef = useRef(
    new Map<string, { audio: HTMLAudioElement; cleanup: () => void }>()
  );

  const missingDurationKey = useMemo(
    () =>
      episodes
        .filter(
          (episode) => {
            const key = `${episode.type || "episode"}:${episode.id}`;
            return !isPositiveDuration(episode.duration) && !durationsByKey[key];
          }
        )
        .map((episode) => `${episode.type || "episode"}:${episode.id}:${episode.audioUrl || ""}`)
        .sort()
        .join(","),
    [durationsByKey, episodes]
  );

  useEffect(() => {
    if (typeof Audio === "undefined") {
      return;
    }

    const missingItems = missingDurationKey
      .split(",")
      .filter(Boolean)
      .map((str) => {
        const parts = str.split(":");
        const type = parts[0];
        const id = parts[1];
        const audioUrl = parts.slice(2).join(":"); // reconstruct URL
        return { key: `${type}:${id}`, type, id, audioUrl };
      });

    const missingKeys = new Set(missingItems.map(item => item.key));

    for (const [key, probe] of audioProbesRef.current) {
      if (!missingKeys.has(key)) {
        probe.cleanup();
        audioProbesRef.current.delete(key);
      }
    }

    for (const item of missingItems) {
      if (audioProbesRef.current.has(item.key)) {
        continue;
      }

      const audio = new Audio();
      const handleDuration = () => {
        const nextDuration = readDuration(audio);
        if (!nextDuration) {
          return;
        }

        setDurationsByKey((current) =>
          current[item.key] === nextDuration
            ? current
            : { ...current, [item.key]: nextDuration }
        );
      };
      const ignoreError = () => {};

      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", handleDuration);
      audio.addEventListener("durationchange", handleDuration);
      audio.addEventListener("error", ignoreError);
      
      const url = item.type === "audiobook" && item.audioUrl 
        ? item.audioUrl 
        : `/api/episodes/${item.id}/audio`;
        
      audio.src = url;

      audioProbesRef.current.set(item.key, {
        audio,
        cleanup: () => {
          audio.removeEventListener("loadedmetadata", handleDuration);
          audio.removeEventListener("durationchange", handleDuration);
          audio.removeEventListener("error", ignoreError);
          audio.pause();
          audio.src = "";
        },
      });
    }
  }, [missingDurationKey]);

  useEffect(
    () => () => {
      for (const probe of audioProbesRef.current.values()) {
        probe.cleanup();
      }
      audioProbesRef.current.clear();
    },
    []
  );

  return useCallback(
    (episode: EpisodeDurationSource) => {
      if (isPositiveDuration(episode.duration)) {
        return episode.duration;
      }
      const key = `${episode.type || "episode"}:${episode.id}`;
      return durationsByKey[key] ?? null;
    },
    [durationsByKey]
  );
}
