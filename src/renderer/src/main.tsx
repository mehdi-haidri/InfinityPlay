import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/outfit";
import { App } from "./App";
import "./styles.css";
import { installRendererStreamSigner } from "./lib/streamSigner";

installRendererStreamSigner();

const container = document.getElementById("root");
if (!container) throw new Error("Root container missing from index.html");

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
