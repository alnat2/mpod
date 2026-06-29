import {
  AddPodcast,
  AuthCard,
  BottomNav,
  EpisodeRow,
  FileDropzone,
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

const featuredEpisode = {
  title: "Mock Episode Title",
  podcastTitle: "Mock Podcast Title",
  artworkUrl: undefined,
  artworkAlt: "Artwork",
  elapsedLabel: "10:00",
  durationLabel: "45:00",
  progressValue: 22,
};

const queueEpisodes = [
  { title: "Ep 1", podcastTitle: "Podcast 1", durationLabel: "10m", current: true },
  { title: "Ep 2", podcastTitle: "Podcast 2", durationLabel: "20m" },
];

const showNotesText = "Mock notes";

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

      <PreviewSection title="Navigation">
        <div className="w-full rounded-lg border border-border">
          <TopNav />
        </div>
        <div className="w-[320px]">
          <BottomNav activeItem="Subscriptions" />
        </div>
        <Logo />
        <div className="w-full max-w-[900px]">
          <PageHeader title="Now playing" actions={[]} />
        </div>
      </PreviewSection>

      <PreviewSection title="Auth">
        <AuthCard />
      </PreviewSection>

      <PreviewSection title="Library">
        <PodcastCard
          title="Decoder Ring"
          description="A culture podcast about things that might seem small or insignificant, but that actually reveal a lot about how we live. We crack the cultural mysteries you didn't even know were mysteries."
          artworkUrl={featuredEpisode.artworkUrl}
          artworkAlt={featuredEpisode.artworkAlt}
        />
        <div className="w-full max-w-[1040px]">
          <EpisodeRow
            title={featuredEpisode.title}
            podcastTitle={featuredEpisode.podcastTitle}
            dateLabel="Mar 31, 2026"
            durationLabel="54m"
            thumbnailUrl={featuredEpisode.artworkUrl}
            thumbnailAlt={featuredEpisode.artworkAlt}
          />
        </div>
      </PreviewSection>

      <PreviewSection title="Playback">
        <Player
          title={featuredEpisode.title}
          podcastTitle={featuredEpisode.podcastTitle}
          artworkUrl={featuredEpisode.artworkUrl}
          artworkAlt={featuredEpisode.artworkAlt}
          elapsedLabel={featuredEpisode.elapsedLabel}
          durationLabel={featuredEpisode.durationLabel}
          progressValue={featuredEpisode.progressValue}
        />
        <PlaylistQueue summary="3 episodes · 2h 13m" className="max-w-[1040px]">
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
      </PreviewSection>

      <PreviewSection title="Add podcast">
        <AddPodcast />
        <FileDropzone />
      </PreviewSection>

      <PreviewSection title="Settings and notes">
        <SettingItem
          title="Export OPML"
          description="Download the current subscription list as an OPML file."
          action={<Button type="button">Export OPML</Button>}
        />
        <ShowNotes
          podcastTitle={featuredEpisode.podcastTitle}
          episodeTitle={featuredEpisode.title}
        >
          {showNotesText}
        </ShowNotes>
      </PreviewSection>
    </main>
  );
}
