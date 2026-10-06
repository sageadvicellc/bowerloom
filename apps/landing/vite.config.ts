import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import release from "../../release/beta.json" with { type: "json" };

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const metadata: Record<string, string> = {
  RELEASE_TITLE: `${release.product} · ${release.statusLabel}`,
  RELEASE_DESCRIPTION: `${release.capabilities.setup} ${release.capabilities.execution}`,
  RELEASE_STATUS: release.statusLabel,
  RELEASE_AVAILABILITY: release.npm.availabilityNote,
  DOCS_PATH: new URL(release.urls.docs).pathname,
};

export default defineConfig({
  plugins: [react(), {
    name: "shared-release-metadata",
    transformIndexHtml: html => html.replace(/%(RELEASE_[A-Z_]+|DOCS_PATH)%/g, (_match, key: string) => escapeHtml(metadata[key])),
  }],
  build: { chunkSizeWarningLimit: 700 },
});
