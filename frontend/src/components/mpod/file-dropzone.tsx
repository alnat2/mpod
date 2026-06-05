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
        "flex min-h-[232px] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-lg border border-dashed border-primary bg-background p-6 transition-colors",
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
        <p className="text-center text-sm leading-5 font-medium text-foreground">
          Drag and drop your file
        </p>
        <HugeiconsIcon
          icon={FileUploadIcon}
          className="size-20 text-primary"
          aria-hidden="true"
        />
        <p className="text-center text-xs leading-4 text-muted-foreground">
          or click to browse from your computer
        </p>
        {fileName ? (
          <p className="text-center text-xs leading-4 font-medium text-card-foreground">
            {fileName}
          </p>
        ) : null}
      </div>
      <input
        className={cn(
          "block h-9 w-[132px] cursor-pointer overflow-hidden text-sm text-transparent file:mr-0 file:h-9 file:w-[132px] file:cursor-pointer file:rounded-md file:border-0 file:bg-transparent file:px-4 file:text-sm file:font-medium file:text-primary file:underline-offset-4 file:hover:underline",
          disabled && "pointer-events-none opacity-50"
        )}
        type="file"
        disabled={disabled}
        aria-label="Browse files"
        onChange={(event) => {
          onFileChange?.(event.target.files?.[0] ?? null);
        }}
      />
    </div>
  );
}
