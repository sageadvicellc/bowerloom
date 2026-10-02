import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./projection-tokens.css";
import "./styles.css";
import "./cinematic.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
