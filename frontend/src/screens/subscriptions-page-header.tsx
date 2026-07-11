import type { ReactNode } from "react";

import { PageHeader } from "@/components/mpod";
import { Button } from "@/components/ui/button";

export type SubscriptionsPageAction = {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  variant: "default" | "secondary";
};

type SubscriptionsPageHeaderProps = {
  actions: SubscriptionsPageAction[];
  isMobile: boolean;
  subtitle: string;
  title: string;
};

export function SubscriptionsPageHeader({
  actions,
  isMobile,
  subtitle,
  title,
}: SubscriptionsPageHeaderProps) {
  if (isMobile) {
    return (
      <div className="px-5 pt-4">
        <PageHeader
          layout="mobile"
          title={title}
          subtitle={subtitle}
          actions={actions}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <h1 className="truncate text-3xl leading-9 font-semibold tracking-normal text-foreground">
          {title}
        </h1>
        <p className="truncate text-base leading-6 font-medium text-muted-foreground">
          {subtitle}
        </p>
      </div>
      {actions.length > 0 ? (
        <div className="flex h-[34px] shrink-0 items-center gap-2 overflow-hidden">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              disabled={action.disabled}
              variant={action.variant}
              className={action.variant === "default" ? "shadow-xs" : undefined}
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
