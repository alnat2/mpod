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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HugeiconsIcon } from "@hugeicons/react";
import { AudioBook01Icon } from "@hugeicons/core-free-icons";

const featuredEpisode = {
  title: "Why store loyalty cards became a UX minefield",
  podcastTitle: "Decoder Ring",
  artworkUrl: undefined,
  artworkAlt: "Artwork",
  elapsedLabel: "23:14",
  durationLabel: "54:03",
  progressValue: 44,
};

const queueEpisodes = [
  {
    title: featuredEpisode.title,
    podcastTitle: featuredEpisode.podcastTitle,
    durationLabel: "00:54",
    current: true,
  },
  {
    title: "The hidden ergonomics of habit trackers",
    podcastTitle: "Decoder Ring",
    durationLabel: "00:48",
    current: false,
  },
];

const showNotesText = `This modal version keeps the main player context visible behind a muted backdrop while giving long show notes enough dedicated space.

Some podcast feeds include full essays, dense links, guest bios, sponsor copy, chapters, transcript excerpts, and source references.

Recommendation for MVP: use this modal pattern when show notes are opened from the focused player on smaller screens or when notes are long.`;

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
        <div id="audit-logo" className="p-4 bg-background inline-block rounded border border-border">
          <Logo />
        </div>
      </PreviewSection>

      {/* 2. TopNav */}
      <PreviewSection title="2. TopNav">
        <div id="audit-topnav" className="w-[1440px] max-w-full rounded-lg border border-border bg-background">
          <TopNav activeItem="Player" />
        </div>
      </PreviewSection>

      {/* 3. AppShell */}
      <PreviewSection title="3. AppShell">
        <div id="audit-appshell" className="w-[1440px] max-w-full h-[700px] overflow-hidden rounded-lg border border-border bg-background">
          <AppShell pageTitle="Now playing" activeNavItem="Player">
            <div className="py-8">
              <p className="text-muted-foreground">AppShell content container</p>
            </div>
          </AppShell>
        </div>
      </PreviewSection>

      {/* 4. AuthShell & AuthCard */}
      <PreviewSection title="4. AuthShell & AuthCard">
        <div id="audit-auth" className="w-[1440px] max-w-full min-h-[700px] rounded-lg border border-border bg-background">
          <AuthShell headline="Log in to mpod">
            <AuthCard title="Log in" submitLabel="Log in" />
          </AuthShell>
        </div>
      </PreviewSection>

      {/* 5. Player */}
      <PreviewSection title="5. Player">
        <div id="audit-player" className="w-[484px] max-w-full bg-card p-4 rounded-xl border border-border">
          <Player
            title={featuredEpisode.title}
            podcastTitle={featuredEpisode.podcastTitle}
            artworkUrl={featuredEpisode.artworkUrl}
            artworkAlt={featuredEpisode.artworkAlt}
            elapsedLabel={featuredEpisode.elapsedLabel}
            durationLabel={featuredEpisode.durationLabel}
            progressValue={featuredEpisode.progressValue}
            speedLabel="Speed 1.3x"
            notesDisabled={false}
            onProgressSeek={() => undefined}
          />
        </div>
      </PreviewSection>

      {/* 6. PlaylistQueue & EpisodeRow */}
      <PreviewSection title="6. PlaylistQueue & EpisodeRow">
        <div id="audit-queue" className="w-[1044px] max-w-full bg-card p-4 rounded-xl border border-border">
          <PlaylistQueue summary="3 episodes · 2h 13m">
            {queueEpisodes.map((episode) => (
              <EpisodeRow
                current={episode.current}
                title={episode.title}
                podcastTitle={episode.podcastTitle}
                durationLabel={episode.durationLabel}
                thumbnailUrl={featuredEpisode.artworkUrl}
                thumbnailAlt={featuredEpisode.artworkAlt}
                key={episode.title}
              />
            ))}
          </PlaylistQueue>
        </div>
      </PreviewSection>

      {/* 7. AddPodcast & FileDropzone */}
      <PreviewSection title="7. AddPodcast & FileDropzone">
        <div id="audit-addpodcast" className="w-[1024px] max-w-full bg-card p-6 rounded-xl border border-border flex flex-col gap-6">
          <AddPodcast />
          <FileDropzone />
        </div>
      </PreviewSection>

      {/* 8. ShowNotes */}
      <PreviewSection title="8. ShowNotes">
        <div id="audit-shownotes" className="w-[730px] max-w-full bg-card p-6 rounded-xl border border-border">
          <ShowNotes
            podcastTitle={featuredEpisode.podcastTitle}
            episodeTitle={featuredEpisode.title}
          >
            {showNotesText}
          </ShowNotes>
        </div>
      </PreviewSection>

      {/* 9. PodcastCard */}
      <PreviewSection title="9. PodcastCard">
        <div id="audit-podcastcard" className="w-[688px] max-w-full bg-card p-6 rounded-xl border border-border flex gap-6">
          <PodcastCard
            title="Decoder Ring"
            description="A culture podcast about things that might seem small or insignificant, but that actually reveal a lot about how we live."
            artworkUrl={featuredEpisode.artworkUrl}
            artworkAlt={featuredEpisode.artworkAlt}
          />
          <PodcastCard
            selected
            title="The Daily"
            description="This is what the news should sound like. The biggest stories of our time, told by the best journalists in the world."
          />
        </div>
      </PreviewSection>

      {/* 10. Filemanager Item */}
      <PreviewSection title="10. Filemanager Item">
        <div id="audit-filemanager" className="w-[1044px] max-w-full bg-card p-6 rounded-xl border border-border flex flex-col gap-3">
          <FileManagerItem type="folder" title="Sci-Fi Audiobooks" duration="12 items" />
          <FileManagerItem type="audiobook" title="Project Hail Mary" duration="16:10:00" inPlaylist={false} />
          <FileManagerItem type="track" title="01 - Introduction.mp3" duration="00:15:30" inPlaylist={true} />
        </div>
      </PreviewSection>

      {/* 11. AbookChapter */}
      <PreviewSection title="11. AbookChapter">
        <div id="audit-abookchapter" className="w-[730px] max-w-full bg-background p-4">
          <Card
            data-slot="abook-chapters-modal"
            className="flex w-full flex-col gap-5 overflow-hidden rounded-[20px] bg-card p-8 shadow-xl ring-1 ring-border"
          >
            <div className="flex items-center gap-6">
              <div className="size-16 shrink-0 rounded-md border border-border bg-muted flex items-center justify-center">
                <HugeiconsIcon icon={AudioBook01Icon} size={32} className="text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-2xl leading-8 font-semibold text-foreground">
                  Project Hail Mary
                </h2>
                <p className="truncate text-base leading-6 font-medium text-muted-foreground">
                  Andy Weir · 16:10:00
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm font-medium">Chapter 01</span>
                <span className="text-sm text-muted-foreground">00:45:12</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-border">
                <span className="text-sm font-medium">Chapter 02</span>
                <span className="text-sm text-muted-foreground">00:52:30</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm font-medium">Chapter 03</span>
                <span className="text-sm text-muted-foreground">00:48:10</span>
              </div>
            </div>
          </Card>
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
