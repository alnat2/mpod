import { HugeiconsIcon } from "@hugeicons/react";
import { PodcastIcon } from "@hugeicons/core-free-icons";

import { AppShell } from "@/components/mpod";
import { Button } from "@/components/ui/button";

export function NoPodcastsScreen() {
  return (
    <AppShell
      activeNavItem="Home"
      pageTitle="No podcasts"
      pageSubtitle="Start with one RSS feed or import subscriptions from another app."
      pageActions={[]}
    >
      <div className="flex h-full min-h-[686px] w-full items-start justify-center overflow-hidden rounded-lg p-6">
        <section className="flex w-full max-w-[1190px] flex-col items-center justify-center p-12">
          <div className="flex w-full max-w-96 flex-col items-center gap-6">
            <div className="flex w-full flex-col items-center gap-2">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <HugeiconsIcon icon={PodcastIcon} aria-hidden="true" />
              </div>
              <h2 className="text-center text-lg leading-7 font-medium text-card-foreground">
                No podcasts yet
              </h2>
              <p className="text-center text-sm leading-5 text-muted-foreground">
                Add one RSS feed or bring subscriptions from another podcast app
                with OPML.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Button type="button">Add RSS feed</Button>
              <Button variant="outline" type="button">
                Import OPML
              </Button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
