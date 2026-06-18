import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { liveApiPlugin } from "./server/liveApiPlugin";

export default defineConfig({
  plugins: [react(), liveApiPlugin()],
  test: {
    environment: "jsdom",
    globals: true
  }
});
