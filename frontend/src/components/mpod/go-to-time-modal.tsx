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
          "h-[377px] w-[320px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-border bg-card p-0 shadow-xs",
          className
        )}
      >
        <div className="flex h-[52px] items-center justify-between px-5 pt-[18px] pb-2.5">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-sm leading-5 font-normal text-muted-foreground transition-colors hover:text-foreground active:opacity-70"
          >
            Cancel
          </button>
          <span className="text-base leading-6 font-medium text-muted-foreground">
            Go to time
          </span>
          <button
            type="button"
            onClick={handleDone}
            className="cursor-pointer text-sm leading-5 font-semibold text-primary transition-opacity hover:opacity-80 active:opacity-60"
          >
            Done
          </button>
        </div>

        <div className="flex h-[93px] flex-col items-center px-[7.5px] pt-2">
          <div
            data-testid="go-to-time-display"
            className="flex h-[62px] w-full select-none items-center justify-center rounded-xl bg-muted text-[28px] leading-[42px] font-semibold tracking-[0.7px] text-muted-foreground"
          >
            {displayTime}
          </div>
          <span className="select-none text-[10px] leading-[15px] text-muted-foreground">
            {hasHours
              ? "Enter hours, minutes, seconds"
              : "Enter minutes, seconds"}
          </span>
        </div>

        <div className="grid h-[232px] grid-cols-3 gap-2 px-0.5 pb-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0"].map(
            (key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleKeyPress(key)}
                className={cn(
                  "flex h-12 w-full cursor-pointer select-none items-center justify-center rounded-xl border border-border bg-card text-xl font-medium text-foreground shadow-xs transition-all hover:bg-accent active:scale-95",
                  key === "00" && "border-transparent bg-muted shadow-none"
                )}
              >
                {key}
              </button>
            )
          )}
          <button
            type="button"
            aria-label="Backspace"
            onClick={() => handleKeyPress("backspace")}
            className="flex h-12 w-full cursor-pointer select-none items-center justify-center rounded-xl border border-transparent bg-muted text-foreground transition-all hover:bg-muted/70 active:scale-95"
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
