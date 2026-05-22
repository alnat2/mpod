import { HugeiconsIcon } from "@hugeicons/react";
import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
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
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        "flex min-h-[232px] w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-lg border border-dashed border-primary bg-background p-6",
        className
      )}
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
        ref={inputRef}
        className="hidden"
        type="file"
        accept=".opml,text/x-opml,text/xml,application/xml"
        disabled={disabled}
        onChange={(event) => {
          onFileChange?.(event.target.files?.[0] ?? null);
        }}
      />
      <Button
        variant="link"
        className="h-9 px-4 no-underline hover:no-underline"
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Browse files
      </Button>
    </div>
  );
}
