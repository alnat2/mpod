import { HugeiconsIcon } from "@hugeicons/react";
import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { useState, type DragEvent } from "react";

import { cn } from "@/lib/utils";

type FileDropzoneProps = {
  className?: string;
  disabled?: boolean;
  fileName?: string;
  onFileChange?: (file: File | null) => void;
};

export function FileDropzone({
  className,
  disabled,
  fileName,
  onFileChange,
}: FileDropzoneProps) {
  const [dragActive, setDragActive] = useState(false);

  function preventFileNavigation(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function extractDroppedFile(event: DragEvent<HTMLDivElement>) {
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) {
      return;
    }
    onFileChange?.(file);
  }

  return (
    <div
      className={cn(
        "flex min-h-[132px] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-primary bg-background p-6 transition-colors md:min-h-[232px] md:gap-4",
        dragActive && "bg-primary/5",
        className
      )}
      onDragEnter={(event) => {
        if (disabled) {
          return;
        }
        preventFileNavigation(event);
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (disabled) {
          return;
        }
        preventFileNavigation(event);
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (disabled) {
          return;
        }
        preventFileNavigation(event);
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setDragActive(false);
      }}
      onDrop={(event) => {
        if (disabled) {
          return;
        }
        preventFileNavigation(event);
        setDragActive(false);
        extractDroppedFile(event);
      }}
    >
      <div className="flex flex-col items-center justify-center gap-2">
        <p className="text-center text-sm leading-5 font-medium text-foreground md:hidden">
          Click to browse
          <br />
          from your computer
        </p>
        <p className="hidden text-center text-sm leading-5 font-medium text-foreground md:block">
          Drag and drop your file
        </p>
        <HugeiconsIcon
          icon={FileUploadIcon}
          className="hidden size-20 text-primary md:block"
          aria-hidden="true"
        />
        <p className="hidden text-center text-xs leading-4 text-muted-foreground md:block">
          or click to browse from your computer
        </p>
        {fileName ? (
          <p className="text-center text-xs leading-4 font-medium text-card-foreground">
            {fileName}
          </p>
        ) : null}
      </div>
      <div
        className={cn(
          "relative h-9 w-[132px]",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-sm leading-5 font-medium text-primary"
        >
          Browse files
        </span>
        <input
          className="absolute inset-0 block h-9 w-[132px] cursor-pointer overflow-hidden text-sm text-transparent file:mr-0 file:h-9 file:w-[132px] file:cursor-pointer file:rounded-md file:border-0 file:bg-transparent file:px-4 file:text-sm file:font-medium file:text-transparent"
          type="file"
          disabled={disabled}
          aria-label="Browse files"
          onChange={(event) => {
            onFileChange?.(event.target.files?.[0] ?? null);
          }}
        />
      </div>
    </div>
  );
}
