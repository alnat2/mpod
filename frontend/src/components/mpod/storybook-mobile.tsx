import type { ReactNode } from "react";

export function MobileComponentFrame({ children }: { children: ReactNode }) {
  return <div className="w-[360px] max-w-full">{children}</div>;
}

export function MobileShellFrame({ children }: { children: ReactNode }) {
  return (
    <div className="h-[800px] w-[360px] max-w-full overflow-hidden rounded-lg bg-background">
      {children}
    </div>
  );
}
