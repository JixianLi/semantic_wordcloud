import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@core/index.css";
import App from "@core/App";
import "@/Scenarios/SemanticWordCloud";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App initialConfig="ScenarioConfigs/SemanticWordCloud.json" />
  </StrictMode>
);
