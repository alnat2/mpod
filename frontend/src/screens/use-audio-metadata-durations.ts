import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Episode } from "@/lib/api";

type EpisodeDurationSource = Pick<Episode, "id" | "duration">;

function isPositiveDuration(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readDuration(audio: HTMLAudioElement) {
  return isPositiveDuration(audio.duration) ? Math.round(audio.duration) : null;
}

export function useAudioMetadataDurations(
  episodes: EpisodeDurationSource[]
) {
  const [durationsByEpisodeId, setDurationsByEpisodeId] = useState<
    Record<number, number>
  >({});
  const audioProbesRef = useRef(
    new Map<number, { audio: HTMLAudioElement; cleanup: () => void }>()
  );

  const missingDurationKey = useMemo(
    () =>
      episodes
        .filter(
          (episode) =>
            !isPositiveDuration(episode.duration) &&
            !durationsByEpisodeId[episode.id]
        )
        .map((episode) => episode.id)
        .sort((a, b) => a - b)
        .join(","),
    [durationsByEpisodeId, episodes]
  );

  useEffect(() => {
    if (typeof Audio === "undefined") {
      return;
    }

    const missingEpisodeIds = new Set(
      missingDurationKey
        .split(",")
        .filter(Boolean)
        .map(Number)
        .filter(Number.isFinite)
    );

    for (const [episodeId, probe] of audioProbesRef.current) {
      if (!missingEpisodeIds.has(episodeId)) {
        probe.cleanup();
        audioProbesRef.current.delete(episodeId);
      }
    }

    for (const episodeId of missingEpisodeIds) {
      if (audioProbesRef.current.has(episodeId)) {
        continue;
      }

      const audio = new Audio();
      const handleDuration = () => {
        const nextDuration = readDuration(audio);
        if (!nextDuration) {
          return;
        }

        setDurationsByEpisodeId((current) =>
          current[episodeId] === nextDuration
            ? current
            : { ...current, [episodeId]: nextDuration }
        );
      };
      const ignoreError = () => {};

      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", handleDuration);
      audio.addEventListener("durationchange", handleDuration);
      audio.addEventListener("error", ignoreError);
      audio.src = `/api/episodes/${episodeId}/audio`;

      audioProbesRef.current.set(episodeId, {
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
    (episode: EpisodeDurationSource) =>
      isPositiveDuration(episode.duration)
        ? episode.duration
        : durationsByEpisodeId[episode.id] ?? null,
    [durationsByEpisodeId]
  );
}
