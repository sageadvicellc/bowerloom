import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./projection-tokens.css";
import "./styles.css";
import "./cinematic.css";
import "./navigation.css";
import "./brand.css";
import { applyTheme, resolveTheme, savedThemePreference } from "./theme";

applyTheme(resolveTheme(savedThemePreference(), window.matchMedia("(prefers-color-scheme: dark)").matches));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
