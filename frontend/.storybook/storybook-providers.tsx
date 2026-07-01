import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { MemoryRouter } from "react-router-dom";

import { TooltipProvider } from "../src/components/ui/tooltip";

export function StorybookProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <MemoryRouter initialEntries={["/subscriptions"]}>
        <TooltipProvider>
          <div className="min-h-screen bg-background p-6 text-foreground">
            {children}
          </div>
        </TooltipProvider>
      </MemoryRouter>
    </ThemeProvider>
  );
}
