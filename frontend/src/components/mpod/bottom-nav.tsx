import { HugeiconsIcon } from "@hugeicons/react";
import {
  AudioBook01Icon,
  DashboardSquareAddIcon,
  PlayIcon,
  PodcastIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

type BottomNavItem = {
  href?: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
};

type BottomNavProps = {
  activeItem?: string;
  className?: string;
  onAdd?: () => void;
};

const defaultItems: BottomNavItem[] = [
  {
    href: "/home",
    icon: (
      <HugeiconsIcon
        icon={PlayIcon}
        className="size-7"
        strokeWidth={1.5}
        aria-hidden="true"
        data-icon-name="hugeicons/play"
      />
    ),
    label: "Player",
  },
  {
    href: "/subscriptions",
    icon: (
      <HugeiconsIcon
        icon={PodcastIcon}
        className="size-7"
        strokeWidth={1.5}
        aria-hidden="true"
        data-icon-name="hugeicons/podcast"
      />
    ),
    label: "Podcasts",
  },
  {
    href: "/audiobooks",
    icon: (
      <HugeiconsIcon
        icon={AudioBook01Icon}
        className="size-7"
        strokeWidth={1.5}
        aria-hidden="true"
        data-icon-name="hugeicons/audio-book-01"
      />
    ),
    label: "Abooks",
  },
  {
    href: "/settings",
    icon: (
      <HugeiconsIcon
        icon={Settings01Icon}
        className="size-7"
        strokeWidth={1.5}
        aria-hidden="true"
        data-icon-name="hugeicons/setting-01"
      />
    ),
    label: "Settings",
  },
  {
    icon: (
      <HugeiconsIcon
        icon={DashboardSquareAddIcon}
        className="size-7"
        strokeWidth={1.5}
        aria-hidden="true"
        data-icon-name="hugeicons/dashboard-square-add"
      />
    ),
    label: "Add",
  },
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
      <div className="flex h-[65px] w-full min-w-0 items-center justify-between">
        {defaultItems.map((item) => {
          const isActive =
            item.label === activeItem ||
            (item.label === "Podcasts" && activeItem === "Subscriptions") ||
            (item.label === "Abooks" && activeItem === "Audiobooks");
          const content = (
            <>
              <span
                className={cn(
                  "flex h-6 w-7 items-center justify-center",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {item.icon}
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
