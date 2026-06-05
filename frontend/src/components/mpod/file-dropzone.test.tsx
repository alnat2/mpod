import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FileDropzone } from "./file-dropzone";

describe("FileDropzone", () => {
  it("keeps the file input inside the visible browse control so mobile Safari can open the picker", async () => {
    const user = userEvent.setup();
    const handleFileChange = vi.fn();

    render(<FileDropzone onFileChange={handleFileChange} />);

    const input = screen.getByLabelText("Browse files");
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveClass("opacity-0");
    expect(input).not.toHaveClass("hidden");
    expect(input).not.toHaveClass("sr-only");

    const file = new File(["<opml />"], "feeds.opml", {
      type: "text/x-opml",
    });

    await user.upload(input, file);

    expect(handleFileChange).toHaveBeenCalledWith(file);
  });
});
