import { HugeiconsIcon } from "@hugeicons/react";
import {
  AudioBook04Icon,
  Playlist02Icon,
  PlusSignSquareIcon,
  Settings05Icon,
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

function SubscriptionsIcon() {
  return (
    <svg
      className="size-7"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      data-icon-name="hugeicons/rss"
    >
      <g transform="translate(1.33335 3.08335)">
        <path
          d="M13.8235 20.8333C14.6641 20.8333 14.9912 20.8282 14.9912 20.8282C18.977 20.7995 21.1742 20.6116 22.6232 19.3811C24.3333 17.9288 24.3333 15.5914 24.3333 10.9167C24.3333 6.24191 24.3333 3.90452 22.6232 2.45226C20.913 1 18.1606 1 12.6557 1C7.15083 1 4.39838 1 2.68824 2.45226C1.37831 3.56465 1.07175 5.19635 1.00001 8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2.14617 19.6667H2.15664"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M1.00001 15.274C3.90883 15.274 6.56562 17.9167 6.56562 20.8329M10.3333 20.8329C10.3333 15.5833 5.66097 11.5 1.05276 11.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

const defaultItems: BottomNavItem[] = [
  {
    href: "/home",
    icon: <HugeiconsIcon icon={Playlist02Icon} className="size-7" aria-hidden="true" />,
    label: "Player",
  },
  {
    href: "/subscriptions",
    icon: <SubscriptionsIcon />,
    label: "Podcasts",
  },
  {
    href: "/audiobooks",
    icon: <HugeiconsIcon icon={AudioBook04Icon} className="size-7" aria-hidden="true" />,
    label: "Abooks",
  },
  {
    href: "/settings",
    icon: <HugeiconsIcon icon={Settings05Icon} className="size-7" aria-hidden="true" />,
    label: "Settings",
  },
  {
    icon: <HugeiconsIcon icon={PlusSignSquareIcon} className="size-7" aria-hidden="true" />,
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
      <div className="flex h-[65px] w-full min-w-0 items-center justify-center gap-4">
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
