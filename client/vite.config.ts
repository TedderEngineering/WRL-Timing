import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      // Two HTML shells for one app: index.html (RaceTrace) and grip.html
      // (Finding Grip, with its own title, icon and link-preview tags).
      input: {
        main: path.resolve(__dirname, "index.html"),
        grip: path.resolve(__dirname, "grip.html"),
      },
    },
  },
});
