import type { FormEvent } from "react";
import { useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading02Icon,
  MultiplicationSignIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { FileDropzone } from "./file-dropzone";

type AddPodcastMode = "rss" | "opml";
type AddPodcastSubmit =
  | { mode: "rss"; rssUrl: string }
  | { mode: "opml"; file: File };

type AddPodcastProps = {
  className?: string;
  disabled?: boolean;
  error?: string | null;
  mode?: AddPodcastMode;
  onModeChange?: (mode: AddPodcastMode) => void;
  onClose?: () => void;
  onCancel?: () => void;
  onSubmit?: (value: AddPodcastSubmit) => void;
  submitting?: boolean;
};

export function AddPodcast({
  className,
  disabled,
  error,
  mode,
  onModeChange,
  onClose,
  onCancel,
  onSubmit,
  submitting = false,
}: AddPodcastProps) {
  const isModeControlled = mode !== undefined && onModeChange !== undefined;
  const [uncontrolledMode, setUncontrolledMode] = useState<AddPodcastMode>(
    mode ?? "rss"
  );
  const [rssUrl, setRssUrl] = useState("");
  const [opmlFile, setOPMLFile] = useState<File | null>(null);
  const activeMode = isModeControlled ? mode : uncontrolledMode;
  const isOpml = activeMode === "opml";

  function handleModeChange(value: string) {
    const nextMode = value as AddPodcastMode;
    onModeChange?.(nextMode);

    if (!isModeControlled) {
      setUncontrolledMode(nextMode);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isOpml) {
      if (opmlFile) {
        onSubmit?.({ mode: "opml", file: opmlFile });
      }
      return;
    }

    onSubmit?.({ mode: "rss", rssUrl });
  }

  return (
    <Card
      className={cn(
        "w-full max-w-[320px] items-start gap-0 rounded-lg py-0 shadow-sm md:max-w-[720px]",
        className
      )}
    >
      <form className="contents" onSubmit={handleSubmit}>
        <CardHeader className="flex w-full flex-row items-center gap-3 px-4 py-5 md:px-6">
          <CardTitle className="min-w-0 flex-1 text-xl leading-7 font-semibold">
            Add Podcast
          </CardTitle>
          <Button
            aria-label="Close"
            className="size-8 md:size-10"
            size="icon-sm"
            variant="ghost"
            type="button"
            disabled={disabled}
            onClick={onClose}
          >
            <HugeiconsIcon
              icon={MultiplicationSignIcon}
              className="size-4"
              aria-hidden="true"
            />
          </Button>
        </CardHeader>
        <div className="px-4 pb-3 md:px-6">
          <Tabs
            value={activeMode}
            onValueChange={handleModeChange}
          >
            <TabsList className="h-9 gap-2 p-1">
              <TabsTrigger
                className="h-7 px-2 py-1 data-active:border-border data-active:shadow-xs"
                value="rss"
                disabled={disabled}
              >
                RSS Feed URL
              </TabsTrigger>
              <TabsTrigger
                className="h-7 px-2 py-1 data-active:border-border data-active:shadow-xs"
                value="opml"
                disabled={disabled}
              >
                Import OPML File
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <CardContent className="w-full border-t border-border px-4 py-5 md:px-6">
          {isOpml ? (
            <FileDropzone
              disabled={disabled}
              fileName={opmlFile?.name}
              onFileChange={setOPMLFile}
            />
          ) : (
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="podcast-rss-url">Paste RSS feed URL</FieldLabel>
                <Input
                  id="podcast-rss-url"
                  name="rssUrl"
                  type="url"
                  value={rssUrl}
                  placeholder="https://feeds.example.com/podcast.xml"
                  disabled={disabled}
                  onChange={(event) => setRssUrl(event.target.value)}
                />
              </Field>
            </FieldGroup>
          )}
          {error ? (
            <p className="pt-3 text-sm leading-5 text-destructive">{error}</p>
          ) : null}
        </CardContent>
        <CardFooter className="w-full justify-end gap-3 border-t-0 bg-card px-4 py-5 md:px-6">
          <Button
            className="flex-1 md:flex-none"
            variant="secondary"
            type="button"
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 md:flex-none"
            type="submit"
            disabled={disabled || (isOpml && !opmlFile)}
          >
            {submitting ? (
              <>
                <HugeiconsIcon
                  icon={Loading02Icon}
                  className="animate-spin"
                  data-icon="inline-start"
                />
                {isOpml ? "Importing..." : "Adding..."}
              </>
            ) : isOpml ? (
              "Import file"
            ) : (
              "Add Feed"
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
