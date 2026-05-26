import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ModalScreenProps = {
  className?: string;
  children?: ReactNode;
};

export function ModalScreen({ className, children }: ModalScreenProps) {
  return (
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center overflow-hidden bg-foreground/30 p-5 backdrop-blur-[2px] md:p-6",
        className
      )}
    >
      <div className="flex max-h-full max-w-full flex-col items-center overflow-hidden">
        {children}
      </div>
    </div>
  );
}
