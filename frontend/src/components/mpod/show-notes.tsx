import { HugeiconsIcon } from "@hugeicons/react";
import {
  MultiplicationSignIcon,
} from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ShowNotesProps = {
  className?: string;
  podcastTitle: string;
  episodeTitle: string;
  children: string;
  onClose?: () => void;
};

const SHOW_NOTES_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION = new Set([".", ",", "!", "?", ";", ":"]);
const CLOSING_URL_DELIMITERS: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
};

function countCharacter(value: string, character: string) {
  return [...value].filter((current) => current === character).length;
}

function splitUrlAndTrailingText(candidate: string) {
  let url = candidate;
  let trailingText = "";

  while (url.length > 0) {
    const lastCharacter = url.at(-1);
    if (!lastCharacter) {
      break;
    }

    if (TRAILING_URL_PUNCTUATION.has(lastCharacter)) {
      trailingText = lastCharacter + trailingText;
      url = url.slice(0, -1);
      continue;
    }

    const openingDelimiter = CLOSING_URL_DELIMITERS[lastCharacter];
    if (
      openingDelimiter &&
      countCharacter(url, lastCharacter) > countCharacter(url, openingDelimiter)
    ) {
      trailingText = lastCharacter + trailingText;
      url = url.slice(0, -1);
      continue;
    }

    break;
  }

  return { url, trailingText };
}

function linkifyShowNotes(text: string): ReactNode[] {
  const content: ReactNode[] = [];
  let previousIndex = 0;

  for (const match of text.matchAll(SHOW_NOTES_URL_PATTERN)) {
    const index = match.index;
    if (index > previousIndex) {
      content.push(text.slice(previousIndex, index));
    }

    const candidate = match[0];
    const { url, trailingText } = splitUrlAndTrailingText(candidate);
    content.push(
      <a
        href={url}
        key={`${index}-${url}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        {url}
      </a>
    );
    if (trailingText) {
      content.push(trailingText);
    }

    previousIndex = index + candidate.length;
  }

  if (previousIndex < text.length) {
    content.push(text.slice(previousIndex));
  }

  return content;
}

function NotesAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: typeof MultiplicationSignIcon;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          size="icon-lg"
          variant="outline"
          type="button"
          onClick={onClick}
        >
          <HugeiconsIcon icon={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ShowNotes({
  className,
  podcastTitle,
  episodeTitle,
  children,
  onClose,
}: ShowNotesProps) {
  return (
    <Card
      className={cn(
        "w-full max-w-[320px] gap-4 rounded-[20px] p-4 shadow-md md:max-w-[720px] md:gap-5 md:p-8",
        className
      )}
    >
      <header className="flex w-full items-start gap-4 md:items-center md:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <h2 className="text-2xl leading-8 font-semibold">Show notes</h2>
          <p className="text-base leading-6 font-medium text-muted-foreground md:truncate">
            {podcastTitle} - {episodeTitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <NotesAction
            label="Close"
            icon={MultiplicationSignIcon}
            onClick={onClose}
          />
        </div>
      </header>
      <div className="max-h-[360px] w-full overflow-y-auto whitespace-pre-wrap pr-1 text-base leading-6 text-card-foreground break-words [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 md:max-h-[408px] md:pr-4">
        {linkifyShowNotes(children)}
      </div>
    </Card>
  );
}
