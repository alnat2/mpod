import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SettingItemProps = {
  className?: string;
  title: string;
  description: string;
  action?: ReactNode;
  actionLabel?: string;
  children?: ReactNode;
};

export function SettingItem({
  className,
  title,
  description,
  action,
  actionLabel,
  children,
}: SettingItemProps) {
  return (
    <Card
      className={cn(
        "w-full flex-col items-start justify-center gap-5 rounded-md p-4 shadow-xs",
        className
      )}
    >
      <div className="flex w-full items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-base leading-6 font-semibold text-card-foreground">
            {title}
          </h3>
          <p className="text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
        {action ??
          (actionLabel ? (
            <Button size="sm" type="button">
              {actionLabel}
            </Button>
          ) : null)}
      </div>
      {children ? (
        <div className="flex w-full flex-col gap-4 text-sm leading-5 font-medium text-secondary-foreground">
          {children}
        </div>
      ) : null}
    </Card>
  );
}
