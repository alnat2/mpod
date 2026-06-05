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
        "flex min-h-screen max-w-[100vw] overflow-x-hidden items-start justify-center bg-background px-5 py-5 md:items-center md:px-6 md:py-18",
        className
      )}
    >
      <div className="flex w-full max-w-[1200px] flex-col items-start justify-center gap-5 md:items-center md:gap-16 lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col items-start gap-[22px]">
          <Logo />
          <h1 className="max-w-[620px] text-4xl leading-10 font-bold tracking-normal text-foreground md:text-5xl md:leading-12">
            {headline}
          </h1>
        </section>
        {children ?? <AuthCard />}
      </div>
    </main>
  );
}
