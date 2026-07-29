import type { ReactNode } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export type BottomSheetAction = {
  disabled?: boolean;
  label: string;
  icon: IconSvgElement;
  iconClassName?: string;
  onClick?: () => void;
};

type BottomSheetProps = {
  actions: BottomSheetAction[];
  defaultOpen?: boolean;
  subtitle?: string;
  title: string;
  trigger: ReactNode;
};

export function BottomSheet({
  actions,
  defaultOpen,
  subtitle,
  title,
  trigger,
}: BottomSheetProps) {
  return (
    <Drawer defaultOpen={defaultOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="rounded-t-lg border border-border bg-background text-foreground">
        <div className="flex flex-col px-6 py-4 text-left">
          <DrawerTitle className="text-lg leading-7 font-semibold">
            {title}
          </DrawerTitle>
          {subtitle ? (
            <DrawerDescription className="text-sm leading-5 font-normal">
              {subtitle}
            </DrawerDescription>
          ) : null}
        </div>
        <div className="border-t border-border pb-4">
          {actions.map((action) => (
            <DrawerClose asChild key={action.label}>
              <button
                className="flex h-11 w-full items-center gap-2 px-6 text-left text-base leading-6 font-normal transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                disabled={action.disabled}
                type="button"
                onClick={action.onClick}
              >
                <HugeiconsIcon
                  icon={action.icon}
                  className={cn("size-5 shrink-0", action.iconClassName)}
                  aria-hidden="true"
                />
                <span>{action.label}</span>
              </button>
            </DrawerClose>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
