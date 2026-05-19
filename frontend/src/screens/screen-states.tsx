import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ScreenStateProps = {
  actions?: ReactNode;
  className?: string;
  description?: string;
  title: string;
};

export function ErrorBanner({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive",
        className
      )}
    >
      {children}
    </div>
  );
}

export function UndoBanner({
  message,
  onUndo,
}: {
  message: string;
  onUndo: () => void;
}) {
  return (
    <div className="flex min-h-10 w-full items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2 text-sm leading-5 text-secondary-foreground">
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <Button variant="link" type="button" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

export function EmptyState({
  actions,
  className,
  description,
  title,
}: ScreenStateProps) {
  return (
    <section
      className={cn(
        "flex min-h-[560px] w-full items-center justify-center rounded-lg bg-card p-12",
        className
      )}
    >
      <div className="flex max-w-96 flex-col items-center gap-6 text-center">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg leading-7 font-medium text-card-foreground">
            {title}
          </h2>
          {description ? (
            <p className="text-sm leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
      </div>
    </section>
  );
}

export function ListLoadingState({
  className,
  label,
}: {
  className?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[560px] w-full flex-col gap-3 rounded-lg bg-card p-6",
        className
      )}
      aria-label={label}
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-4 gap-5">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-[220px] rounded-lg" key={index} />
        ))}
      </div>
      <Skeleton className="mt-2 h-[50px] rounded-md" />
      <Skeleton className="h-[70px] rounded-md" />
      <Skeleton className="h-[70px] rounded-md" />
      <Skeleton className="h-[70px] rounded-md" />
    </div>
  );
}

export function CenterLoadingState({
  className,
  label,
}: {
  className?: string;
  label: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[560px] w-full items-center justify-center rounded-lg bg-card p-12",
        className
      )}
      aria-label={label}
      aria-busy="true"
    >
      <div className="flex w-full max-w-[480px] flex-col gap-4">
        <span className="sr-only">{label}</span>
        <Skeleton className="mx-auto size-40 rounded-lg" />
        <Skeleton className="h-7 w-full rounded-md" />
        <Skeleton className="mx-auto h-5 w-2/3 rounded-md" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="flex justify-center gap-4">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      </div>
    </div>
  );
}
