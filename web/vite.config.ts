import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Aliases, dedupe and the DRAGGABLE_DEBUG / optimizeDeps workarounds follow vendor/webuvisbox/CREATE_SCENARIO.md.
export default defineConfig({
  // Relative asset paths: GitHub Pages serves the site under /semantic_wordcloud/, not at the domain root.
  base: "./",
  plugins: [react()],
  define: { "process.env.DRAGGABLE_DEBUG": "false" },
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "vendor/webuvisbox/src"),
      "@": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom", "mobx", "mobx-react-lite", "@mui/material", "@emotion/react", "@emotion/styled"],
  },
  optimizeDeps: {
    include: ["prop-types", "react-is", "react-grid-layout/legacy"],
    rolldownOptions: {
      transform: { define: { "process.env.DRAGGABLE_DEBUG": "false" } },
    },
  },
});
