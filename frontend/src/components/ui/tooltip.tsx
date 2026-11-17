"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

type TooltipContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  isControlled: boolean;
};

const TooltipContext = React.createContext<TooltipContextValue | null>(null);

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange]
  );

  return (
    <TooltipContext.Provider
      value={{
        open,
        setOpen: handleOpenChange,
        isControlled,
      }}
    >
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </TooltipContext.Provider>
  );
}

function TooltipTrigger({
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContextMenu,
  onFocus,
  onBlur,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const context = React.useContext(TooltipContext);
  const longPressTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = React.useRef<{ x: number; y: number } | null>(null);
  const isLongPressRef = React.useRef(false);
  const wasTouchRef = React.useRef(false);

  const clearLongPressTimer = React.useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      clearLongPressTimer();
      clearCloseTimer();
    };
  }, [clearLongPressTimer, clearCloseTimer]);

  // When tooltip opens via long press, dismiss on any subsequent tap on the screen
  React.useEffect(() => {
    if (!context?.open) return;

    const handleGlobalPointerDown = () => {
      context.setOpen(false);
    };

    const timer = setTimeout(() => {
      window.addEventListener("pointerdown", handleGlobalPointerDown, {
        capture: true,
        once: true,
      });
    }, 50);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", handleGlobalPointerDown, {
        capture: true,
      });
    };
  }, [context]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(event);
    if (event.defaultPrevented) return;

    if (event.pointerType === "touch") {
      wasTouchRef.current = true;
      isLongPressRef.current = false;
      touchStartPosRef.current = { x: event.clientX, y: event.clientY };
      clearLongPressTimer();
      clearCloseTimer();

      longPressTimerRef.current = setTimeout(() => {
        isLongPressRef.current = true;
        context?.setOpen(true);
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(10);
          } catch {}
        }
      }, 400);
    } else {
      wasTouchRef.current = false;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerMove?.(event);
    if (event.defaultPrevented) return;

    if (touchStartPosRef.current && event.pointerType === "touch") {
      const dx = Math.abs(event.clientX - touchStartPosRef.current.x);
      const dy = Math.abs(event.clientY - touchStartPosRef.current.y);
      if (dx > 10 || dy > 10) {
        clearLongPressTimer();
        if (isLongPressRef.current) {
          context?.setOpen(false);
          isLongPressRef.current = false;
        }
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerUp?.(event);
    clearLongPressTimer();

    if (isLongPressRef.current) {
      clearCloseTimer();
      closeTimerRef.current = setTimeout(() => {
        context?.setOpen(false);
        isLongPressRef.current = false;
      }, 2000);
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    onPointerCancel?.(event);
    clearLongPressTimer();
    if (isLongPressRef.current) {
      context?.setOpen(false);
      isLongPressRef.current = false;
    }
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    onContextMenu?.(event);
    if (isLongPressRef.current) {
      event.preventDefault();
    }
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isLongPressRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    onClick?.(event);
    if (!event.defaultPrevented) {
      event.currentTarget?.blur();
      context?.setOpen(false);
    }
  };

  const handleFocus = (event: React.FocusEvent<HTMLButtonElement>) => {
    onFocus?.(event);

    let isFocusVisible = false;
    try {
      isFocusVisible = Boolean(event.currentTarget?.matches?.(":focus-visible"));
    } catch {}

    if (wasTouchRef.current || !isFocusVisible) {
      event.preventDefault();
      setTimeout(() => {
        wasTouchRef.current = false;
      }, 200);
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLButtonElement>) => {
    onBlur?.(event);
    clearLongPressTimer();
    clearCloseTimer();
    wasTouchRef.current = false;
    if (isLongPressRef.current) {
      isLongPressRef.current = false;
      context?.setOpen(false);
    }
  };

  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={handleContextMenu}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={handleClick}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
