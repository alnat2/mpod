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
  subtitle?: ReactNode;
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
        <h1
          className={cn(
            "w-full font-semibold tracking-normal text-foreground",
            isMobile
              ? "text-2xl leading-8"
              : isDesktop
                ? "text-3xl leading-9"
                : "text-2xl leading-8 md:text-3xl md:leading-9"
          )}
        >
          {title}
        </h1>
        {subtitle ? (
          <div className="w-full text-base leading-6 font-medium text-muted-foreground">
            {subtitle}
          </div>
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
                  ? "size-11 rounded-[10px] !p-0 shadow-xs [&_svg]:size-6" 
                  : isDesktop 
                    ? "h-8 px-2.5" 
                    : "size-11 max-md:!p-0 max-md:rounded-[10px] max-md:[&_svg]:size-6 md:h-8 md:w-auto md:px-2.5",
                action.variant === "default" && "shadow-xs",
                (isMobile || !isDesktop) &&
                  action.variant === "secondary" &&
                  "max-md:border max-md:border-border max-md:bg-background max-md:text-primary max-md:hover:bg-background/80"
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
