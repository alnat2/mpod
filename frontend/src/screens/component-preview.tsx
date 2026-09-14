import { useSearchParams } from "react-router-dom";
import {
  AddPodcast,
  AppShell,
  AuthCard,
  AuthShell,
  BottomNav,
  EpisodeRow,
  FileDropzone,
  FileManagerItem,
  Logo,
  PageHeader,
  Player,
  PlaylistQueue,
  PodcastCard,
  SettingItem,
  ShowNotes,
  TopNav,
} from "@/components/mpod";
import { AudiobookPlaybackChaptersModal } from "@/components/mpod/audiobook-playback-chapters-modal";
import { ModalScreen } from "@/components/mpod/modal-screen";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PauseIcon,
  PlayIcon,
  PlayListRemoveIcon,
  Refresh01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import episodeArtwork from "@/assets/episode-artwork.png";
import type { Audiobook } from "@/lib/api";

const showNotesText = `This modal version keeps the main player context visible behind a muted backdrop while giving long show notes enough dedicated space. It is useful when notes need more reading focus than a side panel can comfortably provide.

Some podcast feeds include full essays, dense links, guest bios, sponsor copy, chapters, transcript excerpts, and source references. In modal mode the text area should scroll independently, while the modal header and close action remain obvious.

Recommendation for MVP: use this modal pattern when show notes are opened from the focused player on smaller screens or when notes are long. On wider desktop layouts, the side panel can still work, but the modal is safer for overflow-heavy content.

The scrollbar on the right is intentionally visible here. It communicates that there is more content without inventing a fake button-like affordance.`;

const previewAudiobook: Audiobook = {
  id: 1,
  title: "Abook title",
  author: "Author",
  relPath: "abooks/Abook title",
  hasCover: false,
  totalDuration: 10440,
  trackCount: 6,
  listenedCount: 1,
  isListened: false,
  inPlaylist: true,
  positionSeconds: 2160,
  createdAt: "2026-09-14T00:00:00Z",
  updatedAt: "2026-09-14T00:00:00Z",
  tracks: [
    {
      id: 1,
      audiobookId: 1,
      trackNumber: 1,
      title: "Chapter1.mp3",
      relPath: "Chapter1.mp3",
      filePath: "/share/audio/abooks/Chapter1.mp3",
      duration: 1440,
      isListened: true,
      inPlaylist: true,
      positionSeconds: 1440,
    },
    {
      id: 2,
      audiobookId: 1,
      trackNumber: 2,
      title: "Chapter2.mp3",
      relPath: "Chapter2.mp3",
      filePath: "/share/audio/abooks/Chapter2.mp3",
      duration: 1440,
      isListened: false,
      inPlaylist: true,
      positionSeconds: 720,
    },
    {
      id: 3,
      audiobookId: 1,
      trackNumber: 3,
      title: "Chapter3.mp3",
      relPath: "Chapter3.mp3",
      filePath: "/share/audio/abooks/Chapter3.mp3",
      duration: 2700,
      isListened: false,
      inPlaylist: true,
      positionSeconds: 0,
    },
    {
      id: 4,
      audiobookId: 1,
      trackNumber: 4,
      title: "Chapter4.mp3",
      relPath: "Chapter4.mp3",
      filePath: "/share/audio/abooks/Chapter4.mp3",
      duration: 1800,
      isListened: false,
      inPlaylist: true,
      positionSeconds: 0,
    },
    {
      id: 5,
      audiobookId: 1,
      trackNumber: 5,
      title: "Chapter5.mp3",
      relPath: "Chapter5.mp3",
      filePath: "/share/audio/abooks/Chapter5.mp3",
      duration: 3000,
      isListened: false,
      inPlaylist: true,
      positionSeconds: 0,
    },
    {
      id: 6,
      audiobookId: 1,
      trackNumber: 6,
      title: "Chapter6.mp3",
      relPath: "Chapter6.mp3",
      filePath: "/share/audio/abooks/Chapter6.mp3",
      duration: 900,
      isListened: false,
      inPlaylist: true,
      positionSeconds: 0,
    },
  ],
};

function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <h2 className="text-xl leading-7 font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-6">{children}</div>
    </section>
  );
}

export function ComponentPreview() {
  const [searchParams] = useSearchParams();
  const modalParam = searchParams.get("modal");

  if (modalParam === "shownotes") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <ModalScreen title="Show notes" onClose={() => undefined}>
          <ShowNotes
            podcastTitle="Decoder Ring"
            episodeTitle="Why store loyalty cards became a UX minefield"
            onClose={() => undefined}
          >
            {showNotesText}
          </ShowNotes>
        </ModalScreen>
      </div>
    );
  }

  if (modalParam === "abookchapter") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AudiobookPlaybackChaptersModal
          audiobook={previewAudiobook}
          currentTrackId={2}
          currentDurationSeconds={1440}
          playing={true}
          onClose={() => undefined}
          onPlayTrack={() => undefined}
        />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-8 overflow-auto bg-background p-8 text-foreground">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl leading-9 font-semibold">mpod component preview</h1>
        <p className="text-sm text-muted-foreground">
          Review surface for recreated components. Each item is one component instance;
          visual states are controlled by props in the component code.
        </p>
      </header>

      {/* 1. Logo */}
      <PreviewSection title="1. Logo">
        <div id="audit-logo" className="inline-block bg-background">
          <Logo />
        </div>
      </PreviewSection>

      {/* 2. TopNav */}
      <PreviewSection title="2. TopNav">
        <div id="audit-topnav" className="w-[1440px] max-w-full bg-background">
          <TopNav activeItem="Player" />
        </div>
      </PreviewSection>

      {/* 3. AppShell */}
      <PreviewSection title="3. AppShell">
        <div id="audit-appshell" className="h-[900px] w-[1440px] max-w-full overflow-hidden bg-background">
          <AppShell
            pageTitle="Subscriptions"
            pageSubtitle="Short description"
            activeNavItem="Player"
            pageActions={[
              {
                label: "Refresh all",
                icon: <HugeiconsIcon icon={Refresh01Icon} />,
                variant: "outline",
              },
              {
                label: "Show all",
                icon: <HugeiconsIcon icon={ViewIcon} />,
                variant: "default",
              },
            ]}
          >
            <div className="h-[700px] w-full rounded-[10px] border border-border bg-card" />
          </AppShell>
        </div>
      </PreviewSection>

      {/* 4. AuthShell & AuthCard */}
      <PreviewSection title="4. AuthShell & AuthCard">
        <div id="audit-auth" className="h-[900px] w-[1440px] max-w-full overflow-hidden bg-background">
          <AuthShell headline="Create the only account for your podcast library">
            <AuthCard />
          </AuthShell>
        </div>
      </PreviewSection>

      {/* 5. Player */}
      <PreviewSection title="5. Player">
        <div id="audit-player" className="w-[480px] max-w-full">
          <Player
            title="Why store loyalty cards became a UX minefield"
            podcastTitle="Decoder Ring"
            artworkUrl={episodeArtwork}
            artworkAlt="Decoder Ring"
            elapsedLabel="23:14"
            durationLabel="14:03"
            progressValue={62}
            speedLabel="Speed 1.5x"
            hasChapters={true}
            playing={false}
            notesDisabled={false}
            onChapters={() => undefined}
            onProgressSeek={() => undefined}
          />
        </div>
      </PreviewSection>

      {/* 6. PlaylistQueue & EpisodeRow */}
      <PreviewSection title="6. PlaylistQueue & EpisodeRow">
        <div id="audit-queue" className="w-[1040px] max-w-full">
          <PlaylistQueue summary="3 episodes · 2h 13m">
            <EpisodeRow
              showDragHandle
              current
              title="Why store loyalty cards became a UX minefield"
              podcastTitle="Decoder Ring"
              durationLabel="54m"
              thumbnailUrl={episodeArtwork}
              actions={[
                { label: "Pause", icon: PauseIcon },
                { label: "Remove from playlist", icon: PlayListRemoveIcon },
              ]}
            />
            <EpisodeRow
              showDragHandle
              title="How public transit maps teach invisible habits"
              podcastTitle="Decoder Ring"
              durationLabel="36m"
              thumbnailUrl={episodeArtwork}
              actions={[
                { label: "Play", icon: PlayIcon },
                { label: "Remove from playlist", icon: PlayListRemoveIcon },
              ]}
            />
            <EpisodeRow
              showDragHandle
              title="The app menu nobody understands but everyone uses"
              podcastTitle="Decoder Ring"
              durationLabel="43m"
              thumbnailUrl={episodeArtwork}
              actions={[
                { label: "Play", icon: PlayIcon },
                { label: "Remove from playlist", icon: PlayListRemoveIcon },
              ]}
            />
          </PlaylistQueue>
        </div>
      </PreviewSection>

      {/* 7. AddPodcast & FileDropzone */}
      <PreviewSection title="7. AddPodcast & FileDropzone">
        <div id="audit-addpodcast" className="flex w-[1488px] max-w-full items-start gap-12">
          <AddPodcast mode="rss" />
          <AddPodcast mode="opml" />
        </div>
        <div id="audit-filedropzone" className="w-[265px]">
          <FileDropzone />
        </div>
      </PreviewSection>

      {/* 8. ShowNotes */}
      <PreviewSection title="8. ShowNotes">
        <div id="audit-shownotes" className="w-[720px] max-w-full">
          <ShowNotes
            podcastTitle="Decoder Ring"
            episodeTitle="Why store loyalty cards became a UX minefield"
            onClose={() => undefined}
          >
            {showNotesText}
          </ShowNotes>
        </div>
      </PreviewSection>

      {/* 9. PodcastCard */}
      <PreviewSection title="9. PodcastCard">
        <div id="audit-podcastcard" className="flex w-[688px] max-w-full items-start gap-12">
          <PodcastCard
            title="Decoder Ring"
            description="Culture stories behind everyday design"
            artworkUrl={episodeArtwork}
          />
          <PodcastCard
            selected
            title="Decoder Ring"
            description="Culture stories behind everyday design"
            artworkUrl={episodeArtwork}
          />
        </div>
      </PreviewSection>

      {/* 10. Filemanager Item */}
      <PreviewSection title="10. Filemanager Item">
        <div id="audit-filemanager" className="flex w-[1040px] max-w-full flex-col gap-2">
          <Breadcrumb className="flex h-[50px] shrink-0 items-center py-0">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink>Abooks</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbEllipsis />
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink>Some abooks</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>New abooks</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-col gap-1">
            <FileManagerItem type="folder" title="Folder with abooks" />
            <FileManagerItem
              type="audiobook"
              title="Folder with audiobook chapters"
              duration="43h 12m"
              onTogglePlaylist={() => undefined}
            />
            <FileManagerItem
              type="track"
              title="A story.mp3"
              duration="1h 24m"
              onTogglePlaylist={() => undefined}
            />
          </div>
        </div>
      </PreviewSection>

      {/* 11. Modals Preview Links */}
      <PreviewSection title="11. Modals (Click to open or use ?modal= URL parameter)">
        <div className="flex gap-4">
          <a
            href="/component-preview?modal=shownotes"
            className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
          >
            Open ShowNotes Modal
          </a>
          <a
            href="/component-preview?modal=abookchapter"
            className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
          >
            Open Audiobook Chapters Modal
          </a>
        </div>
      </PreviewSection>

      <PreviewSection title="Other Primitives">
        <div className="w-[320px]">
          <BottomNav activeItem="Subscriptions" />
        </div>
        <div className="w-full max-w-[900px]">
          <PageHeader title="Now playing" actions={[]} />
        </div>
        <SettingItem
          title="Export OPML"
          description="Download the current subscription list as an OPML file."
          action={<Button type="button">Export OPML</Button>}
        />
      </PreviewSection>
    </main>
  );
}
