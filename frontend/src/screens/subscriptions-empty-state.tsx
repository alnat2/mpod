import { PodcastIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";

type SubscriptionsEmptyStateProps = {
  description: string;
  onAddRss: () => void;
  onImportOpml: () => void;
  title: string;
};

export function SubscriptionsEmptyState({
  description,
  onAddRss,
  onImportOpml,
  title,
}: SubscriptionsEmptyStateProps) {
  return (
    <section className="flex min-h-[256px] w-full items-center justify-center overflow-hidden rounded-lg bg-card p-12">
      <div className="flex w-full max-w-96 flex-col items-center gap-6 text-center">
        <div className="flex w-full flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
            <HugeiconsIcon icon={PodcastIcon} aria-hidden="true" />
          </div>
          <h2 className="text-lg leading-7 font-medium text-card-foreground">
            {title}
          </h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button type="button" onClick={onAddRss}>
            Add RSS feed
          </Button>
          <Button variant="outline" type="button" onClick={onImportOpml}>
            Import OPML
          </Button>
        </div>
      </div>
    </section>
  );
}
