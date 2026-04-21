import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    lib: {
      entry: resolve(__dirname, "src/webview.js"),
      name: "webview",
      fileName: "webview",
      formats: ["iife"],
    },
    rollupOptions: {
      output: {
        // Single file bundle, no code splitting
        inlineDynamicImports: true,
        entryFileNames: "webview.js",
      },
    },
    // Don't minify for easier debugging
    minify: false,
    sourcemap: true,
  },
});
