import type { ReactNode } from "react";

import { AuthCard } from "@/components/mpod/auth-card";
import { Logo } from "@/components/mpod/logo";
import { cn } from "@/lib/utils";

type AuthShellProps = {
  className?: string;
  headline?: string;
  children?: ReactNode;
};

export function AuthShell({
  className,
  headline = "Create the only account for your podcast library",
  children,
}: AuthShellProps) {
  return (
    <main
      className={cn(
        "flex min-h-screen items-center justify-center bg-background px-6 py-18",
        className
      )}
    >
      <div className="flex w-full max-w-[1200px] flex-col items-center gap-16 lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col items-start gap-[22px]">
          <Logo />
          <h1 className="max-w-[620px] text-5xl leading-12 font-bold tracking-normal text-foreground">
            {headline}
          </h1>
        </section>
        {children ?? <AuthCard />}
      </div>
    </main>
  );
}
