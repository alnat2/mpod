import { HugeiconsIcon } from "@hugeicons/react";
import { EyeIcon, FolderSyncIcon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageHeaderAction = {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  variant?: "default" | "secondary" | "outline" | "ghost";
};

type PageHeaderProps = {
  actions?: PageHeaderAction[];
  className?: string;
  subtitle?: string;
  title: string;
};

const defaultActions: PageHeaderAction[] = [
  {
    label: "Refresh all",
    icon: <HugeiconsIcon icon={FolderSyncIcon} data-icon="inline-start" />,
    variant: "secondary",
  },
  {
    label: "Show all",
    icon: <HugeiconsIcon icon={EyeIcon} data-icon="inline-start" />,
    variant: "default",
  },
];

export function PageHeader({
  actions = defaultActions,
  className,
  subtitle = "Short description",
  title,
}: PageHeaderProps) {
  return (
    <div className={cn("flex w-full items-center gap-6", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <h1 className="truncate text-3xl leading-9 font-semibold tracking-normal text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-base leading-6 font-medium text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className="flex h-[34px] shrink-0 items-center gap-2 overflow-hidden">
          {actions.map((action) => (
            <Button
              key={action.label}
              type="button"
              variant={action.variant ?? "secondary"}
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
