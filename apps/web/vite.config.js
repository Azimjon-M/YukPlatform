// Haydovchilar ilovasi: oddiy statik sayt (HTML + JS). base "./" — istalgan manzil yoki papkadan ochiladi
// (haydovchilar serveri http://localhost:3001, Cloudflare Pages, GitHub Pages).
// Dasturlash rejimida (npm run web) /pub so'rovlari haydovchilar serveriga uzatiladi — uni `npm run api` bilan oching.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const publicPort = Number(process.env.PUBLIC_PORT) || 3001;

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, proxy: { "/pub": `http://127.0.0.1:${publicPort}` } },
  preview: { port: 4173 },
});
