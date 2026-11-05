// Mini App: oddiy statik sayt (HTML + JS). base "./" — istalgan manzil yoki papkadan ochiladi (Cloudflare Pages, GitHub Pages).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
});
