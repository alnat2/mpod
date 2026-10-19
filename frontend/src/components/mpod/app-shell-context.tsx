import { createContext, useContext } from "react";

export type AppShellContextType = {
  insideAppShell: boolean;
  setOnAddPodcast: (handler: (() => void) | undefined) => void;
};

export const AppShellContext = createContext<AppShellContextType>({
  insideAppShell: false,
  setOnAddPodcast: () => {},
});

export function useAppShellContext(): AppShellContextType {
  return useContext(AppShellContext);
}
