import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

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
        "flex h-svh w-full flex-col items-center overflow-hidden bg-background",
        className,
      )}
    >
      <TopNav activeItem={activeNavItem} onAdd={onAddPodcast} />
      <main className="flex min-h-0 w-full max-w-[1200px] flex-1 flex-col gap-4 px-6 py-5 text-foreground xl:px-0">
        {pageHeaderVisible ? (
          <PageHeader actions={pageActions} subtitle={pageSubtitle} title={pageTitle} />
        ) : null}
        <div className="min-h-0 flex-1">{children}</div>
      </main>
    </div>
  );
}
