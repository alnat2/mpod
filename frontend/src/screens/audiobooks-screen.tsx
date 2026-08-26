import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshDotIcon } from "@hugeicons/core-free-icons";

import { AppShell, FileManagerItem, PageHeader } from "@/components/mpod";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { AudiobookChaptersModal } from "@/components/mpod/audiobook-chapters-modal";
import { api, type Audiobook } from "@/lib/api";
import { useIsMobileViewport } from "@/lib/use-is-mobile-viewport";
import { AddPodcastModal, type AddPodcastModalMode } from "./add-podcast-modal";
import { ErrorBanner, ScreenBannerStack } from "./screen-states";
import { getErrorMessage } from "./screen-utils";

export type AudiobooksScreenProps = {
  onSessionChange?: () => void | Promise<void>;
};

export function AudiobooksScreen() {
  const isMobile = useIsMobileViewport();
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
      await api.audiobooks.addToPlaylist(book.id);
      setReloadKey((prev) => prev + 1);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  };

  // Group items by currentPath level
  const explorerItems = useMemo(() => {
    const prefix = currentPath.length > 0 ? currentPath.join("/") + "/" : "";
    const folderSet = new Set<string>();
    const directBooks: Audiobook[] = [];

    for (const book of audiobooks) {
      const path = book.relPath || "";
      if (currentPath.length === 0) {
        if (path.includes("/")) {
          const topFolder = path.split("/")[0];
          folderSet.add(topFolder);
        } else {
          directBooks.push(book);
        }
      } else {
        if (path.startsWith(prefix)) {
          const rest = path.slice(prefix.length);
          if (rest.includes("/")) {
            const subFolder = rest.split("/")[0];
            folderSet.add(subFolder);
          } else {
            directBooks.push(book);
          }
        }
      }
    }

    const folders = Array.from(folderSet).sort().map((folderName) => ({
      type: "folder" as const,
      name: folderName,
    }));

    return {
      folders,
      books: directBooks,
    };
  }, [audiobooks, currentPath]);

  const totalItemsCount = audiobooks.length;

  return (
    <AppShell
      activeItem="Abooks"
      onAdd={() => setAddModalMode("rss")}
    >
      <ScreenBannerStack>
        {error && <ErrorBanner message={error} />}
      </ScreenBannerStack>

      <PageHeader
        title="Audiobooks"
        subtitle={`Local collection · ${totalItemsCount} items`}
        actions={[
          {
            key: "refresh",
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
      />

      <div className="flex flex-col gap-4">
        {/* Breadcrumb Navigation */}
        <Breadcrumb className="py-2">
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
        ) : explorerItems.folders.length === 0 && explorerItems.books.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            No audiobooks found in this folder.
          </div>
        ) : (
          <div
            data-slot="filemanager"
            className={isMobile ? "flex flex-col gap-2.5" : "flex flex-col border-t border-border"}
          >
            {/* Folders */}
            {explorerItems.folders.map((folder) => (
              <FileManagerItem
                key={`folder-${folder.name}`}
                type="folder"
                title={folder.name}
                isMobile={isMobile}
                onOpen={() => setCurrentPath([...currentPath, folder.name])}
              />
            ))}

            {/* Books / Tracks */}
            {explorerItems.books.map((book) => {
              const isMultiFile = book.trackCount > 1;
              return (
                <FileManagerItem
                  key={`book-${book.id}`}
                  type={isMultiFile ? "audiobook" : "track"}
                  title={book.title}
                  duration={book.totalDuration}
                  isMobile={isMobile}
                  onOpen={() => {
                    if (isMultiFile) {
                      setSelectedBookForModal(book);
                    }
                  }}
                  onTogglePlaylist={() => void handleTogglePlaylist(book)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Chapters Modal */}
      {selectedBookForModal && (
        <AudiobookChaptersModal
          audiobook={selectedBookForModal}
          isMobile={isMobile}
          onClose={() => setSelectedBookForModal(null)}
          onSelectTrack={() => {
            setSelectedBookForModal(null);
          }}
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
