import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import "./index.css";

registerSW({
  immediate: true,
  onNeedRefresh() {
    // New version available. Do NOT force reload so active audio playback is not interrupted.
    // The updated service worker will cleanly activate on next launch or user refresh.
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
