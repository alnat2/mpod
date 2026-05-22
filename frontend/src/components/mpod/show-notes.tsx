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
        "w-full max-w-[720px] gap-5 rounded-[20px] p-8 shadow-md",
        className
      )}
    >
      <header className="flex w-full items-center gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <h2 className="text-2xl leading-8 font-semibold">Show notes</h2>
          <p className="truncate text-base leading-6 font-medium text-muted-foreground">
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
      <div className="max-h-[408px] w-full overflow-y-auto pr-4 text-base leading-6 whitespace-pre-wrap text-card-foreground">
        {children}
      </div>
    </Card>
  );
}
