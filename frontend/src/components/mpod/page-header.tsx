import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageHeaderAction = {
  disabled?: boolean;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  variant?: "default" | "secondary" | "outline" | "ghost";
};

type PageHeaderProps = {
  actions?: PageHeaderAction[];
  className?: string;
  layout?: "auto" | "desktop" | "mobile";
  subtitle?: string;
  title: string;
};

export function PageHeader({
  actions = [],
  className,
  layout = "auto",
  subtitle = "",
  title,
}: PageHeaderProps) {
  const isMobile = layout === "mobile";
  const isDesktop = layout === "desktop";

  return (
    <div
      className={cn(
        "flex w-full items-center",
        isMobile
          ? "gap-3"
          : isDesktop
            ? "gap-6"
            : "gap-3 md:gap-6",
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <h1 className="w-full text-3xl leading-9 font-semibold tracking-normal text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="w-full text-base leading-6 font-medium text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              title={action.label}
              aria-label={action.label}
              disabled={action.disabled}
              variant={action.variant ?? "secondary"}
              className={cn(
                "shrink-0 justify-center",
                isMobile 
                  ? "size-10 !p-0" 
                  : isDesktop 
                    ? "h-8 px-2.5" 
                    : "size-10 max-md:!p-0 md:h-8 md:w-auto md:px-2.5",
                action.variant === "default" && "shadow-xs"
              )}
              onClick={action.onClick}
            >
              {action.icon}
              <span className={cn(
                "min-w-0 truncate",
                isMobile 
                  ? "sr-only" 
                  : isDesktop 
                    ? "" 
                    : "sr-only md:not-sr-only"
              )}>
                {action.label}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
