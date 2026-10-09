import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {release, readerRelease} from "./src/release.ts";
import social from "../../release/social-preview.json" with {type: "json"};

const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const metadata: Record<string, string> = {
  RELEASE_TITLE: `${release.product} · ${readerRelease.label}`,
  RELEASE_DESCRIPTION: `${readerRelease.capabilities.setup} ${readerRelease.capabilities.execution}`,
  RELEASE_STATUS: readerRelease.label,
  RELEASE_AVAILABILITY: readerRelease.capabilities.execution,
  DOCS_PATH: new URL(release.urls.docs).pathname,
  SOCIAL_TITLE: social.title,
  SOCIAL_DESCRIPTION: social.description,
  SOCIAL_SITE_NAME: social.siteName,
  SOCIAL_TYPE: social.type,
  SOCIAL_URL: release.urls.site,
  SOCIAL_IMAGE: social.image.url,
  SOCIAL_IMAGE_WIDTH: String(social.image.width),
  SOCIAL_IMAGE_HEIGHT: String(social.image.height),
  SOCIAL_IMAGE_TYPE: social.image.type,
  SOCIAL_IMAGE_ALT: social.image.alt,
};

export const renderMetadata = (html: string, values: Record<string, string> = metadata) =>
  html.replace(/%(RELEASE_[A-Z_]+|SOCIAL_[A-Z_]+|DOCS_PATH)%/g, (match, key: string) =>
    Object.hasOwn(values, key) ? escapeHtml(values[key]) : match);

export default defineConfig({
  plugins: [react(), {
    name: "shared-release-metadata",
    transformIndexHtml: html => renderMetadata(html),
  }],
  build: { chunkSizeWarningLimit: 700 },
});
