import type { ReactNode, Ref, UIEventHandler } from "react";

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
    <div className={cn("flex flex-col w-full gap-1", className)}>
      <div className="flex h-[50px] shrink-0 w-full items-center justify-between gap-2 bg-card px-3 rounded shadow-xs text-sm text-muted-foreground">
        <div className="min-w-0 truncate">{summary}</div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      <div
        ref={bodyRef}
        className={cn("flex flex-col gap-1 px-1 -mx-1", bodyClassName)}
        onScroll={bodyOnScroll}
      >
        {children}
      </div>
    </div>
  );
}
