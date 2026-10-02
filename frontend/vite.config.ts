import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiTarget = process.env.MPOD_API_TARGET ?? "http://localhost:5050";
const playbackRevision = createHash("sha256");
for (const file of ["use-playback-audio.ts", "prepared-audio.ts", "playback-audio.ts", "playback-diagnostics.ts", "use-playback-media-session.ts"]) {
  playbackRevision.update(readFileSync(path.resolve(__dirname, "src/lib", file)));
}

export default defineConfig({
  define: { "import.meta.env.VITE_PLAYBACK_REVISION": JSON.stringify(playbackRevision.digest("hex").slice(0, 12).toUpperCase()) },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    proxy: {
	  "/api": {
		target: apiTarget,
		changeOrigin: true,
		configure(proxy) {
		  proxy.on("proxyReq", (request) => {
			request.setHeader("Origin", apiTarget);
		  });
		},
	  },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.stories.{ts,tsx}",
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/vite-env.d.ts",
      ],
    },
  },
});
