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
  pageSubtitle?: string;
  pageTitle: string;
};

export function AppShell({
  activeNavItem,
  children,
  className,
  onAddPodcast,
  pageActions,
  pageSubtitle,
  pageTitle,
}: AppShellProps) {
  return (
    <div
      className={cn(
        "flex h-svh w-full flex-col items-center overflow-hidden bg-background pb-8",
        className,
      )}
    >
      <TopNav activeItem={activeNavItem} onAdd={onAddPodcast} />
      <main className="flex min-h-0 w-full max-w-[1280px] flex-1 flex-col gap-4 rounded-lg border border-border bg-card px-10 py-5 text-card-foreground">
        <PageHeader actions={pageActions} subtitle={pageSubtitle} title={pageTitle} />
        <div className="min-h-0 flex-1 rounded-lg">{children}</div>
      </main>
    </div>
  );
}
