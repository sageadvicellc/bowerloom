import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {release, readerRelease} from "./src/release.ts";

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const metadata: Record<string, string> = {
  RELEASE_TITLE: `${release.product} · ${readerRelease.label}`,
  RELEASE_DESCRIPTION: `${readerRelease.capabilities.setup} ${readerRelease.capabilities.execution}`,
  RELEASE_STATUS: readerRelease.label,
  RELEASE_AVAILABILITY: readerRelease.capabilities.execution,
  DOCS_PATH: new URL(release.urls.docs).pathname,
};

export default defineConfig({
  plugins: [react(), {
    name: "shared-release-metadata",
    transformIndexHtml: html => html.replace(/%(RELEASE_[A-Z_]+|DOCS_PATH)%/g, (_match, key: string) => escapeHtml(metadata[key])),
  }],
  build: { chunkSizeWarningLimit: 700 },
});
