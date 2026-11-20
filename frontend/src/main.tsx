import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import "./index.css";
import {
  cleanupLegacyCaches,
  handleNeedRefresh,
  initPwaUpdate,
} from "./lib/pwa-update";

void cleanupLegacyCaches();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    handleNeedRefresh(updateSW);
  },
});

initPwaUpdate(updateSW);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
