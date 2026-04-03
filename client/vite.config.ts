import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@globefly/shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
  },
});
