import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignSquareIcon } from "@hugeicons/core-free-icons";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
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
  { label: "Subscriptions", href: "/subscriptions" },
  { label: "Settings", href: "/settings" },
];

export function TopNav({
  activeItem = "Player",
  className,
  navItems = defaultNavItems,
  onAdd,
}: TopNavProps) {
  return (
    <header className={cn("flex h-[64px] w-full shrink-0 items-center justify-center bg-background", className)}>
      <div className="flex h-full w-full max-w-[1200px] items-center gap-7 overflow-hidden px-6 xl:px-0">
        <Logo />
        <nav className="flex h-[33px] shrink-0 items-start gap-1" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive = item.label === activeItem;

            return (
              <Button
                key={item.href}
                asChild
                variant={isActive ? "secondary" : "ghost"}
                className={cn("px-4 py-2", isActive && "font-semibold")}
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
            className="size-4"
            data-icon="inline-start"
            aria-hidden="true"
          />
          Add
        </Button>
      </div>
    </header>
  );
}
