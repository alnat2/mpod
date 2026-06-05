import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { BottomNav } from "./bottom-nav";
import { PageHeader } from "./page-header";
import { TopNav } from "./top-nav";

type AppShellProps = {
  activeNavItem?: string;
  children?: ReactNode;
  className?: string;
  onAddPodcast?: () => void;
  pageActions?: ComponentProps<typeof PageHeader>["actions"];
  pageHeaderVisible?: boolean;
  pageSubtitle?: string;
  pageTitle: string;
};

export function AppShell({
  activeNavItem,
  children,
  className,
  onAddPodcast,
  pageActions,
  pageHeaderVisible = true,
  pageSubtitle,
  pageTitle,
}: AppShellProps) {
  return (
    <div
      className={cn(
        "flex h-svh w-full flex-col items-center overflow-hidden bg-background px-5 md:px-6 md:pb-8 xl:px-20",
        className,
      )}
    >
      <TopNav
        activeItem={activeNavItem}
        className="hidden md:flex"
        onAdd={onAddPodcast}
      />
      <main className="flex min-h-0 w-full max-w-[1200px] flex-1 flex-col pb-[65px] text-foreground md:pb-0">
        {pageHeaderVisible ? (
          <PageHeader
            className="py-4 md:py-5"
            actions={pageActions}
            subtitle={pageSubtitle}
            title={pageTitle}
          />
        ) : null}
        <div className="min-h-0 flex-1">{children}</div>
      </main>
      <BottomNav
        activeItem={activeNavItem}
        className="fixed inset-x-0 bottom-0 z-40 mx-auto md:hidden"
        onAdd={onAddPodcast}
      />
    </div>
  );
}
