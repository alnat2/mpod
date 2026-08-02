import { useCallback, useEffect, useRef } from "react";
import type { ReactNode, TouchEvent } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type ModalScreenProps = {
  className?: string;
  children?: ReactNode;
  onClose?: () => void;
  title: string;
};

const SWIPE_CLOSE_DISTANCE = 72;

export function ModalScreen({
  className,
  children,
  onClose,
  title,
}: ModalScreenProps) {
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeArmedRef = useRef(false);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );

  const requestClose = useCallback(() => {
    if (!onClose) {
      return;
    }

    onClose();
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
      onClose();
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (window.history.state?.__mpodModal) {
        window.history.back();
      }
    };
  }, [onClose]);

  useEffect(
    () => () => {
      const previouslyFocusedElement = previouslyFocusedElementRef.current;
      window.setTimeout(() => {
        if (previouslyFocusedElement?.isConnected) {
          previouslyFocusedElement.focus();
        }
      }, 0);
    },
    []
  );

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (!onClose) {
      return;
    }

    const touch = event.touches[0];
    if (!touch) {
      return;
    }

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
    if (!touch) {
      swipeStartRef.current = null;
      swipeArmedRef.current = false;
      return;
    }

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
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          requestClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          aria-modal="true"
          className={cn(
            "fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-5 outline-none md:p-6",
            className
          )}
          onClick={onClose ? requestClose : undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            {title}
          </DialogPrimitive.Title>
          <div
            className="flex max-h-full max-w-full flex-col items-center overflow-hidden"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
