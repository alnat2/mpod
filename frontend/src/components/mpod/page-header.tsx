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
        "flex w-full items-start",
        isMobile
          ? "flex-col gap-3"
          : isDesktop
            ? "flex-row items-center gap-6"
            : "flex-col gap-3 md:flex-row md:items-center md:gap-6",
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
        <div
          className={cn(
            "flex h-[34px] shrink-0 items-center gap-2 overflow-hidden",
            isMobile ? "w-full" : isDesktop ? "w-auto" : "w-full md:w-auto"
          )}
        >
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              disabled={action.disabled}
              variant={action.variant ?? "secondary"}
              className={cn(
                "h-8 justify-center",
                isMobile ? "flex-1" : isDesktop ? "flex-none" : "flex-1 md:flex-none",
                action.variant === "default" && "shadow-xs"
              )}
              onClick={action.onClick}
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
