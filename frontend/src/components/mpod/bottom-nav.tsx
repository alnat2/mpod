import { HugeiconsIcon } from "@hugeicons/react";
import {
  Playlist02Icon,
  PlusSignSquareIcon,
  RssIcon,
  Settings05Icon,
} from "@hugeicons/core-free-icons";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

type BottomNavItem = {
  href?: string;
  icon: typeof Playlist02Icon;
  label: string;
  onClick?: () => void;
};

type BottomNavProps = {
  activeItem?: string;
  className?: string;
  onAdd?: () => void;
};

const defaultItems: BottomNavItem[] = [
  { href: "/home", icon: Playlist02Icon, label: "Player" },
  { href: "/subscriptions", icon: RssIcon, label: "Subscriptions" },
  { href: "/settings", icon: Settings05Icon, label: "Settings" },
  { icon: PlusSignSquareIcon, label: "Add podcast" },
];

export function BottomNav({
  activeItem = "Player",
  className,
  onAdd,
}: BottomNavProps) {
  return (
    <nav
      aria-label="Primary navigation"
      className={cn(
        "flex w-full max-w-[440px] min-w-0 shrink-0 items-center justify-center rounded-t-lg bg-background px-3 pb-[env(safe-area-inset-bottom)]",
        className
      )}
    >
      <div className="flex h-[65px] w-full min-w-0 items-center justify-center gap-4">
        {defaultItems.map((item) => {
          const isActive = item.label === activeItem;
          const content = (
            <>
              <span className="flex h-6 w-7 items-center justify-center">
                <HugeiconsIcon
                  icon={item.icon}
                  className={cn(
                    "size-7",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                  aria-hidden="true"
                />
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-center text-xs leading-4 font-medium tracking-normal",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {item.label}
              </span>
            </>
          );

          if (item.href) {
            return (
              <Link
                key={item.label}
                to={item.href}
                className="flex h-14 shrink-0 flex-col items-center justify-center gap-[3px] py-[3px]"
              >
                {content}
              </Link>
            );
          }

          return (
            <button
              key={item.label}
              type="button"
              className="flex h-14 shrink-0 flex-col items-center justify-center gap-[3px] py-[3px]"
              onClick={item.onClick ?? onAdd}
            >
              {content}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
