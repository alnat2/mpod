import type { ReactNode, Ref, UIEventHandler } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PlaylistQueueProps = {
  bodyClassName?: string;
  bodyOnScroll?: UIEventHandler<HTMLDivElement>;
  bodyRef?: Ref<HTMLDivElement>;
  className?: string;
  headerAction?: ReactNode;
  summary: string;
  children?: ReactNode;
};

export function PlaylistQueue({
  bodyClassName,
  bodyOnScroll,
  bodyRef,
  className,
  headerAction,
  summary,
  children,
}: PlaylistQueueProps) {
  return (
    <Card
      className={cn(
        "flex flex-col w-full gap-0 overflow-hidden rounded-2xl py-0 md:rounded-md",
        className
      )}
    >
      <div className="flex min-h-[50px] shrink-0 w-full items-center gap-3 bg-card px-3 py-2 text-xs leading-4 text-muted-foreground">
        <div className="min-w-0 flex-1 truncate">{summary}</div>
        {headerAction ? <div className="min-w-0 shrink-0">{headerAction}</div> : null}
      </div>
      <div
        ref={bodyRef}
        className={cn("flex w-full flex-col", bodyClassName)}
        onScroll={bodyOnScroll}
      >
        {children}
      </div>
    </Card>
  );
}
