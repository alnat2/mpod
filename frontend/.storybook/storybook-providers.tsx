import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { TooltipProvider } from "../src/components/ui/tooltip";

export function StorybookProviders({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/subscriptions"]}>
      <TooltipProvider>
        <div className="min-h-screen bg-background p-6 text-foreground">
          {children}
        </div>
      </TooltipProvider>
    </MemoryRouter>
  );
}
