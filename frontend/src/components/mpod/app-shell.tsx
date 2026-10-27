import { useContext, useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { AppShellContext } from "./app-shell-context";
import { BottomNav } from "./bottom-nav";
import { PageHeader } from "./page-header";
import { TopNav } from "./top-nav";

type AppShellProps = {
  /**
   * Optional active navigation tab. When rendered inside AuthenticatedAppLayout,
   * the active tab is automatically derived from the router location.
   */
  activeNavItem?: string;
  children?: ReactNode;
  className?: string;
  mainClassName?: string;
  onAddPodcast?: () => void;
  pageActions?: ComponentProps<typeof PageHeader>["actions"];
  pageHeaderVisible?: boolean;
  pageSubtitle?: string;
  pageTitle?: string;
};

export function AppShell({
  activeNavItem,
  children,
  className,
  mainClassName,
  onAddPodcast,
  pageActions,
  pageHeaderVisible = true,
  pageSubtitle,
  pageTitle = "",
}: AppShellProps) {
  const context = useContext(AppShellContext);
  const isInside = context.insideAppShell;
  const onAddPodcastRef = useRef(onAddPodcast);

  useEffect(() => {
    onAddPodcastRef.current = onAddPodcast;
  });

  useEffect(() => {
    if (isInside) {
      context.setOnAddPodcast(() => {
        onAddPodcastRef.current?.();
      });
      return () => {
        context.setOnAddPodcast(undefined);
      };
    }
  }, [isInside, context]);

  if (isInside) {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden",
          mainClassName,
          className
        )}
      >
        {pageHeaderVisible ? (
          <PageHeader
            className="py-4 md:py-5"
            actions={pageActions}
            subtitle={pageSubtitle}
            title={pageTitle}
          />
        ) : null}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-dvh w-full min-w-0 flex-col items-center overflow-hidden bg-background px-5 md:h-full md:px-6 md:pb-8 xl:px-20",
        className
      )}
    >
      <TopNav
        activeItem={activeNavItem}
        className="hidden md:flex"
        onAdd={onAddPodcast}
      />
      <main
        className={cn(
          "flex min-h-0 w-full max-w-[1280px] min-w-0 flex-1 flex-col overflow-hidden pb-[calc(65px+env(safe-area-inset-bottom))] text-foreground md:pb-0",
          mainClassName
        )}
      >
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
