import { HugeiconsIcon } from "@hugeicons/react";
import {
  MultiplicationSignIcon,
} from "@hugeicons/core-free-icons";

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
      <div
        className="max-h-[360px] w-full overflow-y-auto pr-1 text-base leading-6 text-card-foreground break-words [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p]:mb-4 [&_p:last-child]:mb-0 md:max-h-[408px] md:pr-4"
        dangerouslySetInnerHTML={{ __html: children }}
      />
    </Card>
  );
}
