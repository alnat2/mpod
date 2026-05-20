import { useMemo } from "react";
import type { ComponentProps, ReactNode } from "react";

import { usePlayback } from "@/lib/playback-context";
import { cn } from "@/lib/utils";
import { formatClock } from "@/screens/screen-utils";

import { PageHeader } from "./page-header";
import { Player } from "./player";
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
  const playback = usePlayback();
  const currentEpisode = playback.currentEpisode;

  const progressValue = useMemo(() => {
    if (!playback.durationSeconds) return 0;
    return Math.min(
      100,
      Math.round((playback.positionSeconds / playback.durationSeconds) * 100)
    );
  }, [playback.positionSeconds, playback.durationSeconds]);

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
      {currentEpisode ? (
        <div className="flex items-center justify-center w-full bg-muted/50 backdrop-blur-sm border-t border-border px-4 py-2">
          <Player
            title={currentEpisode.title}
            podcastTitle={currentEpisode.podcastTitle}
            artworkUrl={currentEpisode.podcastImageUrl ?? undefined}
            elapsedLabel={formatClock(playback.positionSeconds)}
            durationLabel={formatClock(playback.durationSeconds)}
            playing={playback.playing}
            progressValue={progressValue}
            speedLabel={playback.speedLabel}
            notesDisabled
            onBack={playback.seekBackward}
            onForward={playback.seekForward}
            onPlay={playback.playToggle}
            onNotes={() => {}}
            onSpeedChange={playback.setSpeedLabel}
          />
        </div>
      ) : null}
    </div>
  );
}
