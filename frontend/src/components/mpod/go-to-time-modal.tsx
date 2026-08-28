import { useCallback, useEffect, useState } from "react";
import { ModalScreen } from "./modal-screen";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDigitsToTime, parseDigitsToSeconds } from "./go-to-time-utils";

type GoToTimeModalProps = {
  className?: string;
  totalDurationSeconds?: number;
  onClose: () => void;
  onSeek: (seconds: number) => void;
};

export function GoToTimeModal({
  className,
  totalDurationSeconds = 0,
  onClose,
  onSeek,
}: GoToTimeModalProps) {
  const [digits, setDigits] = useState("");
  const hasHours = totalDurationSeconds >= 3600;
  const maxDigits = hasHours ? 6 : 4;

	const handleKeyPress = useCallback((key: string) => {
    if (key === "backspace") {
      setDigits((prev) => prev.slice(0, -1));
      return;
    }

    if (key === "00") {
      setDigits((prev) => {
        if (!prev) return prev;
        if (prev.length + 2 <= maxDigits) {
          return prev + "00";
        }
        if (prev.length + 1 <= maxDigits) {
          return prev + "0";
        }
        return prev;
      });
      return;
    }

    if (key === "0") {
      setDigits((prev) => {
        if (!prev) return prev;
        if (prev.length + 1 <= maxDigits) {
          return prev + "0";
        }
        return prev;
      });
      return;
    }

    if (/^[1-9]$/.test(key)) {
      setDigits((prev) => {
        if (prev.length + 1 <= maxDigits) {
          return prev + key;
        }
        return prev;
      });
    }
	}, [maxDigits]);

	const handleDone = useCallback(() => {
    let targetSeconds = parseDigitsToSeconds(digits, hasHours);
    if (totalDurationSeconds > 0 && targetSeconds > totalDurationSeconds) {
      targetSeconds = totalDurationSeconds;
    }
    onSeek(targetSeconds);
    onClose();
	}, [digits, hasHours, onClose, onSeek, totalDurationSeconds]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        handleKeyPress(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleKeyPress("backspace");
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleDone();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleDone, handleKeyPress, onClose]);

  const displayTime = formatDigitsToTime(digits, hasHours);

  return (
    <ModalScreen title="Go to time" onClose={onClose}>
      <Card
        data-slot="go-to-time-modal"
        className={cn(
          "w-[320px] max-w-[calc(100vw-32px)] rounded-3xl border border-border bg-card p-4 shadow-2xl transition-all sm:p-5",
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground active:opacity-70 cursor-pointer"
          >
            Cancel
          </button>
          <span className="text-sm font-semibold text-foreground">Go to time</span>
          <button
            type="button"
            onClick={handleDone}
            className="text-sm font-semibold text-primary transition-colors hover:opacity-80 active:opacity-60 cursor-pointer"
          >
            Done
          </button>
        </div>

        {/* Time Display Box */}
        <div className="my-3 flex flex-col items-center justify-center rounded-2xl bg-muted/60 py-3.5 px-4">
          <div
            data-testid="go-to-time-display"
            className="font-mono text-3xl font-bold tracking-wider text-foreground select-none"
          >
            {displayTime}
          </div>
          <span className="mt-1 text-xs text-muted-foreground select-none">
            {hasHours ? "Enter hours, minutes, seconds" : "Enter hours, minutes"}
          </span>
        </div>

        {/* Keypad Grid */}
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map(
            (key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleKeyPress(key)}
                className="flex h-12 w-full select-none items-center justify-center rounded-2xl border border-border/50 bg-card text-xl font-medium text-foreground shadow-xs transition-all hover:bg-accent active:scale-95 cursor-pointer"
              >
                {key}
              </button>
            )
          )}
          {/* Backspace Button */}
          <button
            type="button"
            aria-label="Backspace"
            onClick={() => handleKeyPress("backspace")}
            className="flex h-12 w-full select-none items-center justify-center rounded-2xl border border-border/50 bg-muted/40 text-foreground transition-all hover:bg-muted/70 active:scale-95 cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
          </button>
        </div>
      </Card>
    </ModalScreen>
  );
}
