import { useCallback, useEffect, useRef } from "react";
import type { ReactNode, TouchEvent } from "react";

import { cn } from "@/lib/utils";

type ModalScreenProps = {
  className?: string;
  children?: ReactNode;
  onClose?: () => void;
};

const SWIPE_CLOSE_DISTANCE = 72;

export function ModalScreen({
  className,
  children,
  onClose,
}: ModalScreenProps) {
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeArmedRef = useRef(false);
  const suppressNextPopRef = useRef(false);

  const requestClose = useCallback(() => {
    if (!onClose) {
      return;
    }

    suppressNextPopRef.current = true;
    onClose();
    window.setTimeout(() => {
      window.history.back();
    }, 0);
  }, [onClose]);

  useEffect(() => {
    if (!onClose) {
      return;
    }

    const modalState = {
      ...(window.history.state ?? {}),
      __mpodModal: true,
    };

    window.history.pushState(modalState, "", window.location.href);

    const handlePopState = () => {
      if (suppressNextPopRef.current) {
        suppressNextPopRef.current = false;
        return;
      }

      onClose();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onClose]);

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (!onClose) {
      return;
    }

    const touch = event.touches[0];
    const bounds = event.currentTarget.getBoundingClientRect();
    swipeArmedRef.current = touch.clientY - bounds.top <= 72;
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (!onClose || !swipeArmedRef.current || !swipeStartRef.current) {
      swipeStartRef.current = null;
      swipeArmedRef.current = false;
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - swipeStartRef.current.x;
    const deltaY = touch.clientY - swipeStartRef.current.y;

    swipeStartRef.current = null;
    swipeArmedRef.current = false;

    if (
      deltaY > SWIPE_CLOSE_DISTANCE &&
      Math.abs(deltaY) > Math.abs(deltaX) * 1.2
    ) {
      requestClose();
    }
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-foreground/30 p-5 backdrop-blur-[2px] md:p-6",
        className
      )}
      onClick={onClose ? requestClose : undefined}
    >
      <div
        className="flex max-h-full max-w-full flex-col items-center overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
