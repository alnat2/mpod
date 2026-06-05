import { useState } from "react";

import { AddPodcast, ModalScreen } from "@/components/mpod";
import { api } from "@/lib/api";

import { getErrorMessage } from "./screen-utils";

export type AddPodcastModalMode = "rss" | "opml" | null;

type AddPodcastModalProps = {
  mode: AddPodcastModalMode;
  onClose: () => void;
  onComplete?: () => void;
  onModeChange: (mode: AddPodcastModalMode) => void;
};

export function AddPodcastModal({
  mode,
  onClose,
  onComplete,
  onModeChange,
}: AddPodcastModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!mode) {
    return null;
  }

  async function handleSubmit(
    value: { mode: "rss"; rssUrl: string } | { mode: "opml"; file: File }
  ) {
    setSubmitting(true);
    setError(null);

    try {
      if (value.mode === "rss") {
        await api.podcasts.create(value.rssUrl);
      } else {
        await api.podcasts.importOPML(value.file);
      }
      onClose();
      onComplete?.();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalScreen onClose={onClose}>
      <AddPodcast
        mode={mode}
        disabled={submitting}
        error={error}
        onCancel={onClose}
        onClose={onClose}
        onModeChange={(nextMode) => onModeChange(nextMode)}
        onSubmit={(value) => void handleSubmit(value)}
      />
    </ModalScreen>
  );
}
