import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshDotIcon } from "@hugeicons/core-free-icons";

import { AppShell, FileManagerItem } from "@/components/mpod";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AudiobookChaptersModal } from "@/components/mpod/audiobook-chapters-modal";
import { api, type Audiobook, type AudiobookTrack } from "@/lib/api";
import { usePlaybackDispatch } from "@/lib/playback-context";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";
import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import { ErrorBanner, ScreenBannerStack } from "./screen-states";
import { getErrorMessage } from "./screen-utils";

export type AudiobooksScreenProps = {
  onSessionChange?: () => void | Promise<void>;
};

const AUDIO_FILE_EXTENSIONS = new Set([
  ".mp3",
  ".m4b",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".flac",
  ".wav",
  ".wma",
]);

function isAudioFile(relPath?: string | null): boolean {
  if (!relPath) return false;
  const lastDot = relPath.lastIndexOf(".");
  if (lastDot === -1) return false;
  return AUDIO_FILE_EXTENSIONS.has(relPath.slice(lastDot).toLowerCase());
}

export function AudiobooksScreen(props: AudiobooksScreenProps = {}) {
  void props;
  const isMobile = useIsMobileViewport();
  const { reloadQueue } = usePlaybackDispatch();
  const [audiobooks, setAudiobooks] = useState<Audiobook[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [selectedBookForModal, setSelectedBookForModal] = useState<Audiobook | null>(null);
  const [addModalMode, setAddModalMode] = useState<AddPodcastModalMode>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchAudiobooks() {
      try {
        const response = await api.audiobooks.list();
        if (!cancelled) {
          setAudiobooks(response.audiobooks ?? []);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(getErrorMessage(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchAudiobooks();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleRescan = async () => {
    try {
      setRescanning(true);
      setError(null);
      await api.audiobooks.rescan();
      setReloadKey((prev) => prev + 1);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setRescanning(false);
    }
  };

  const handleTogglePlaylist = async (book: Audiobook) => {
    try {
      const isIn = book.inPlaylist ?? book.isInPlaylist ?? false;
      if (isIn) {
        await api.audiobooks.removeFromPlaylist(book.id);
      } else {
        await api.audiobooks.addToPlaylist(book.id);
      }
      setReloadKey((prev) => prev + 1);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  };

  // Group items by currentPath level: folders first (alphabetical), then files (alphabetical)
  const explorerItems = useMemo(() => {
    const prefix = currentPath.length > 0 ? currentPath.join("/") + "/" : "";
    const folderSet = new Set<string>();
    const directFolderBooks: Audiobook[] = [];
    const directFileBooks: Audiobook[] = [];

    for (const book of audiobooks) {
      const path = book.relPath || "";
      if (currentPath.length === 0) {
        if (path.includes("/")) {
          const topFolder = path.split("/")[0];
          if (topFolder) folderSet.add(topFolder);
        } else {
          const isFile = isAudioFile(book.relPath) && book.trackCount <= 1;
          if (isFile) {
            directFileBooks.push(book);
          } else {
            directFolderBooks.push(book);
          }
        }
      } else {
        if (path.startsWith(prefix)) {
          const rest = path.slice(prefix.length);
          if (rest.includes("/")) {
            const subFolder = rest.split("/")[0];
            if (subFolder) folderSet.add(subFolder);
          } else {
            const isFile = isAudioFile(book.relPath) && book.trackCount <= 1;
            if (isFile) {
              directFileBooks.push(book);
            } else {
              directFolderBooks.push(book);
            }
          }
        }
      }
    }

    const generalFolders = Array.from(folderSet).map((folderName) => ({
      kind: "folder" as const,
      name: folderName,
      title: folderName,
    }));

    const audiobookFolders = directFolderBooks.map((book) => ({
      kind: "audiobook" as const,
      name: book.title,
      title: book.title,
      book,
    }));

    const sortedFolders = [...generalFolders, ...audiobookFolders].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })
    );

    const sortedFiles = directFileBooks
      .map((book) => ({
        kind: "track" as const,
        name: book.title,
        title: book.title,
        book,
      }))
      .sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })
      );

    return {
      folders: sortedFolders,
      files: sortedFiles,
      isEmpty: sortedFolders.length === 0 && sortedFiles.length === 0,
    };
  }, [audiobooks, currentPath]);

  const totalItemsCount = audiobooks.length;

  const handleOpenBookModal = async (book: Audiobook) => {
    try {
      const response = await api.audiobooks.get(book.id);
      setSelectedBookForModal(response.audiobook);
    } catch {
      setSelectedBookForModal(book);
    }
  };

  const handleToggleTrackPlaylist = async (track: AudiobookTrack) => {
    if (!selectedBookForModal) return;
    try {
      const inPlaylist = Boolean(track.inPlaylist ?? track.isInPlaylist);
      if (inPlaylist) {
        await api.audiobooks.removeTrackFromPlaylist(selectedBookForModal.id, track.id);
      } else {
        await api.audiobooks.addTrackToPlaylist(selectedBookForModal.id, track.id);
      }
      setSelectedBookForModal((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          tracks: prev.tracks?.map((t) =>
            t.id === track.id
              ? { ...t, inPlaylist: !inPlaylist, isInPlaylist: !inPlaylist }
              : t
          ),
        };
      });
      await reloadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update track playlist");
    }
  };

  return (
    <AppShell
      activeNavItem="Abooks"
      onAddPodcast={() => setAddModalMode("rss")}
      pageTitle="Audiobooks"
      pageSubtitle={`Local collection · ${totalItemsCount} items`}
      pageActions={[
        {
          label: "Rescan library",
          disabled: rescanning || loading,
          icon: (
            <HugeiconsIcon
              icon={RefreshDotIcon}
              className={rescanning ? "animate-spin" : ""}
              data-icon-name="hugeicons/refresh-dot"
            />
          ),
          onClick: () => void handleRescan(),
        },
      ]}
    >
      <ScreenBannerStack>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </ScreenBannerStack>

      <div className="mpod-scroll flex h-full min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pb-20 md:pb-6">
        {/* Breadcrumb Navigation */}
        <Breadcrumb className="flex h-[50px] shrink-0 items-center py-0">
          <BreadcrumbList>
            <BreadcrumbItem>
              {currentPath.length === 0 ? (
                <BreadcrumbPage>Abooks</BreadcrumbPage>
              ) : (
                <BreadcrumbLink onClick={() => setCurrentPath([])}>
                  Abooks
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>

            {currentPath.map((segment, index) => {
              const isLast = index === currentPath.length - 1;
              const pathToHere = currentPath.slice(0, index + 1);

              return (
                <span key={pathToHere.join("/")} className="inline-flex items-center gap-1.5 sm:gap-2">
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{segment}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink onClick={() => setCurrentPath(pathToHere)}>
                        {segment}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </span>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>

        {/* File Manager Explorer Items List */}
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground" role="status">
            Scanning audiobooks...
          </div>
        ) : explorerItems.isEmpty ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            No audiobooks found in this folder.
          </div>
        ) : (
          <div
            data-slot="filemanager"
            className="flex flex-col gap-1"
          >
            {/* 1. All Folders (general + audiobook folders) sorted alphabetically */}
            {explorerItems.folders.map((item) => {
              if (item.kind === "folder") {
                return (
                  <FileManagerItem
                    key={`folder-${item.name}`}
                    type="folder"
                    title={item.name}
                    isMobile={isMobile}
                    onOpen={() => setCurrentPath([...currentPath, item.name])}
                  />
                );
              }

              return (
                <FileManagerItem
                  key={`book-${item.book.id}`}
                  type="audiobook"
                  title={item.book.title}
                  duration={item.book.totalDuration}
                  inPlaylist={item.book.inPlaylist ?? item.book.isInPlaylist ?? false}
                  isMobile={isMobile}
                  onOpen={() => void handleOpenBookModal(item.book)}
                  onTogglePlaylist={() => void handleTogglePlaylist(item.book)}
                />
              );
            })}

            {/* 2. All Audio Files sorted alphabetically */}
            {explorerItems.files.map((item) => (
              <FileManagerItem
                key={`file-${item.book.id}`}
                type="track"
                title={item.book.title}
                duration={item.book.totalDuration}
                inPlaylist={item.book.inPlaylist ?? item.book.isInPlaylist ?? false}
                isMobile={isMobile}
                onOpen={() => void handleOpenBookModal(item.book)}
                onTogglePlaylist={() => void handleTogglePlaylist(item.book)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Chapters Modal */}
      {selectedBookForModal && (
        <AudiobookChaptersModal
          audiobook={selectedBookForModal}
          isMobile={isMobile}
          onClose={() => setSelectedBookForModal(null)}
          onToggleTrackPlaylist={handleToggleTrackPlaylist}
        />
      )}

      {/* Add Podcast Modal */}
      <AddPodcastModal
        mode={addModalMode}
        onClose={() => setAddModalMode(null)}
        onModeChange={setAddModalMode}
      />
    </AppShell>
  );
}
