import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FileDropzone } from "./file-dropzone";

describe("FileDropzone", () => {
  it("uses a real visible file input so mobile Safari can open the picker", async () => {
    const user = userEvent.setup();
    const handleFileChange = vi.fn();

    render(<FileDropzone onFileChange={handleFileChange} />);

    const input = screen.getByLabelText("Browse files");
    expect(input).toHaveAttribute("type", "file");
    expect(input).not.toHaveClass("hidden");
    expect(input).not.toHaveClass("sr-only");
    expect(input).not.toHaveClass("opacity-0");

    const file = new File(["<opml />"], "feeds.opml", {
      type: "text/x-opml",
    });

    await user.upload(input, file);

    expect(handleFileChange).toHaveBeenCalledWith(file);
  });
});
