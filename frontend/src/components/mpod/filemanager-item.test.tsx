import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileManagerItem } from "./filemanager-item";

describe("FileManagerItem", () => {
  it("renders folder item with folder icon", () => {
    render(<FileManagerItem type="folder" title="Some Author" />);
    expect(screen.getByText("Some Author")).toBeInTheDocument();
    const icon = document.querySelector('[data-icon-name="hugeicons/folder-03"]');
    expect(icon).toBeInTheDocument();
  });

  it("renders audiobook item with duration and add to playlist button", () => {
    const onToggle = vi.fn();
    render(
      <FileManagerItem
        type="audiobook"
        title="Epic Book"
        duration="43h 12m"
        inPlaylist={false}
        onTogglePlaylist={onToggle}
      />
    );
    expect(screen.getByText("Epic Book")).toBeInTheDocument();
    expect(screen.getByText("43h 12m")).toBeInTheDocument();
    expect(document.querySelector('[data-icon-name="hugeicons/folder-audio"]')).toBeInTheDocument();
    
    const btn = screen.getByRole("button", { name: "Add to playlist" });
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
  });

  it("renders track item with remove from playlist button when in playlist", () => {
    const onToggle = vi.fn();
    render(
      <FileManagerItem
        type="track"
        title="Chapter 1.mp3"
        duration="1h 24m"
        inPlaylist={true}
        onTogglePlaylist={onToggle}
      />
    );
    expect(screen.getByText("Chapter 1.mp3")).toBeInTheDocument();
    expect(screen.getByText("1h 24m")).toBeInTheDocument();
    expect(document.querySelector('[data-icon-name="hugeicons/audio-book-01"]')).toBeInTheDocument();
    expect(document.querySelector('[data-icon-name="hugeicons/play-list-remove"]')).toBeInTheDocument();
  });

  it("renders mobile card styling when isMobile is true", () => {
    render(
      <FileManagerItem
        type="audiobook"
        title="Mobile Book"
        duration="2h 30m"
        isMobile={true}
      />
    );
    const item = document.querySelector('[data-slot="fm-item"]');
    expect(item).toHaveClass("rounded-xl");
  });
});
