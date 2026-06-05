import { HugeiconsIcon } from "@hugeicons/react";
import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { useId, useState, type DragEvent } from "react";

import { buttonVariants } from "@/components/ui/button";
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
  const inputId = useId();
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
        id={inputId}
        className="sr-only"
        type="file"
        accept=".opml,text/x-opml,text/xml,application/xml"
        disabled={disabled}
        onChange={(event) => {
          onFileChange?.(event.target.files?.[0] ?? null);
        }}
      />
      <label
        htmlFor={disabled ? undefined : inputId}
        aria-disabled={disabled}
        className={cn(
          buttonVariants({ variant: "link" }),
          "h-9 cursor-pointer px-4 no-underline hover:no-underline",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        Browse files
      </label>
    </div>
  );
}
