import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignSquareIcon } from "@hugeicons/core-free-icons";
import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { prefetchRoute } from "@/lib/route-prefetch";
import { cn } from "@/lib/utils";

import { Logo } from "./logo";

type NavItem = {
  label: string;
  href: string;
};

type TopNavProps = {
  activeItem?: string;
  className?: string;
  navItems?: NavItem[];
  onAdd?: () => void;
};

const defaultNavItems: NavItem[] = [
  { label: "Player", href: "/home" },
  { label: "Podcasts", href: "/subscriptions" },
  { label: "Abooks", href: "/audiobooks" },
  { label: "Settings", href: "/settings" },
];

import { getActiveNavItem } from "./nav-utils";

export function TopNav({
  activeItem,
  className,
  navItems = defaultNavItems,
  onAdd,
}: TopNavProps) {
  const location = useLocation();
  const currentActive = activeItem ?? getActiveNavItem(location.pathname);

  return (
    <header className={cn("flex h-[64px] w-full shrink-0 items-center justify-center bg-background", className)}>
      <div className="flex h-full w-full max-w-[1200px] items-center gap-7 overflow-hidden px-6 xl:px-0">
        <Logo />
        <nav className="flex h-[33px] shrink-0 items-start gap-1" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive =
              item.label === currentActive ||
              (item.label === "Podcasts" && currentActive === "Subscriptions") ||
              (item.label === "Abooks" && currentActive === "Audiobooks");

            return (
              <Button
                key={item.href}
                asChild
                variant={isActive ? "secondary" : "ghost"}
                className={cn("px-4 py-2 text-sm font-medium", isActive && "font-semibold")}
                onMouseEnter={() => prefetchRoute(item.href)}
                onFocus={() => prefetchRoute(item.href)}
              >
                <Link to={item.href}>{item.label}</Link>
              </Button>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1" />
        <Button className="px-3" type="button" variant="secondary" onClick={onAdd}>
          <HugeiconsIcon
            icon={PlusSignSquareIcon}
            className="size-5"
            strokeWidth={1.5}
            aria-hidden="true"
            data-icon-name="hugeicons/plus-sign-square"
          />
          <span className="text-sm leading-5 font-medium">Add</span>
        </Button>
      </div>
    </header>
  );
}
