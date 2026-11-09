// Boshqaruv markazi: oddiy React sayt. Tayyor holi (dist) apps/api serveri orqali ochiladi: http://localhost:3000/admin
// Ishlab chiqishda: npm run dev -w @yuk/admin → http://localhost:5174/admin/ ; /api so'rovlari 3000-portdagi API'ga uzatiladi.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// ADMIN_API — boshqa portdagi sinov serveri (masalan API_PORT=3010 bilan ishga tushirilgan); jonli 3000 ga tegmaslik uchun
const proxy = { "/api": process.env.ADMIN_API || "http://127.0.0.1:3000" };

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: { port: 5174, proxy },
  preview: { port: 4174, proxy },
});
