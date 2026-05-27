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
        "w-full gap-0 overflow-hidden rounded-2xl py-0 md:rounded-md",
        className
      )}
    >
      <div className="flex h-[50px] w-full items-center gap-3 bg-card px-3 text-xs leading-4 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
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
