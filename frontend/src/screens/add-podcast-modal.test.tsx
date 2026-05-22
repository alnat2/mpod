import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";

import { AddPodcastModal } from "./add-podcast-modal";

vi.mock("@/components/mpod", async () => {
  const actual = await vi.importActual<typeof import("@/components/mpod")>(
    "@/components/mpod"
  );

  return {
    ...actual,
    ModalScreen: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});

describe("AddPodcastModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <AddPodcastModal mode={null} onClose={vi.fn()} onModeChange={vi.fn()} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("creates a podcast from an RSS feed URL", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const createSpy = vi.spyOn(api.podcasts, "create").mockResolvedValue({
      podcast: {
        id: 1,
        title: "Decoder Ring",
        rssUrl: "https://example.com/feed.xml",
        description: null,
        imageUrl: null,
        lastChecked: null,
        updateTime: null,
      },
    });

    render(
      <AddPodcastModal
        mode="rss"
        onClose={onClose}
        onComplete={onComplete}
        onModeChange={vi.fn()}
      />
    );

    await user.type(
      screen.getByLabelText("Paste RSS feed URL"),
      "https://example.com/feed.xml"
    );
    await user.click(screen.getByRole("button", { name: "Add Feed" }));

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith("https://example.com/feed.xml");
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("imports an OPML file", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const importSpy = vi.spyOn(api.podcasts, "importOPML").mockResolvedValue({
      success: true,
      imported: 2,
      skipped: 0,
    });

    const { container } = render(
      <AddPodcastModal
        mode="opml"
        onClose={onClose}
        onModeChange={vi.fn()}
      />
    );

    const input = container.querySelector('input[type="file"]');
    const file = new File(["<opml />"], "feeds.opml", {
      type: "application/xml",
    });

    expect(input).not.toBeNull();
    await user.upload(input as HTMLInputElement, file);
    await user.click(screen.getByRole("button", { name: "Import file" }));

    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledWith(file);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a submit error without closing the modal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.spyOn(api.podcasts, "create").mockRejectedValue(
      new ApiError("Feed is invalid", "INVALID_FEED", 400)
    );

    render(
      <AddPodcastModal mode="rss" onClose={onClose} onModeChange={vi.fn()} />
    );

    await user.type(
      screen.getByLabelText("Paste RSS feed URL"),
      "https://example.com/feed.xml"
    );
    await user.click(screen.getByRole("button", { name: "Add Feed" }));

    expect(await screen.findByText("Feed is invalid")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
