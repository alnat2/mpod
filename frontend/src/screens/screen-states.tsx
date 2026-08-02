import { useEffect, useState, type ReactNode } from "react";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type ScreenStateProps = {
  actions?: ReactNode;
  className?: string;
  description?: string;
  title: string;
};

export function ScreenBannerStack({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-none fixed top-[56px] left-1/2 z-50 flex w-full max-w-[1040px] -translate-x-1/2 flex-col gap-3 px-4 md:top-[100px]">
      {children}
    </div>
  );
}

function getRemainingSeconds(expiresAt: number, now: number) {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function ErrorBanner({
  children,
  className,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  onClose?: () => void;
}) {
  return (
    <div
      role="alert"
      aria-atomic="true"
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-5 text-destructive",
        className
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -my-1 size-7 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label="Dismiss error"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

export function UndoBanner({
  expiresAt,
  message,
  onUndo,
}: {
  expiresAt: number;
  message: string;
  onUndo: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [initialRemainingSeconds] = useState(() =>
    getRemainingSeconds(expiresAt, Date.now())
  );
  const remainingSeconds = getRemainingSeconds(expiresAt, now);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="pointer-events-auto flex min-h-10 w-full items-center gap-3 rounded-md border border-border bg-secondary px-3 py-2 text-sm leading-5 text-secondary-foreground">
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {message} Undo available for {initialRemainingSeconds} seconds.
      </span>
      <span className="min-w-0 flex-1 truncate" aria-hidden="true">
        {message} Applying in {remainingSeconds} sec.
      </span>
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
        "flex min-h-[228px] w-full items-center justify-center rounded-md bg-card p-6 md:min-h-[560px] md:rounded-lg md:p-12",
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
        {actions ? (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {actions}
          </div>
        ) : null}
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
        "flex w-full flex-col gap-4 md:min-h-[560px] md:gap-3 md:rounded-lg md:bg-card md:p-6",
        className
      )}
      aria-label={label}
      aria-busy="true"
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div className="flex gap-4 overflow-hidden md:grid md:grid-cols-4 md:gap-5">
        <Skeleton className="h-[390px] w-[320px] shrink-0 rounded-2xl md:h-[220px] md:w-auto md:rounded-lg" />
        <Skeleton className="h-[390px] w-16 shrink-0 rounded-2xl md:hidden" />
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton className="hidden h-[220px] rounded-lg md:block" key={index} />
        ))}
      </div>
      <Skeleton className="mt-1 h-[228px] rounded-2xl md:mt-2 md:h-[50px] md:rounded-md" />
      <Skeleton className="h-[76px] rounded-md" />
      <Skeleton className="h-[76px] rounded-md" />
      <Skeleton className="h-[76px] rounded-md md:h-[70px]" />
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
      aria-live="polite"
      aria-atomic="true"
      role="status"
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
