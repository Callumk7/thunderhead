import { flue } from "@flue/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [flue()],
  server: {
    host: "0.0.0.0",
    port: 8000,
    allowedHosts: ["thunderhead.exe.xyz"],
  },
});
