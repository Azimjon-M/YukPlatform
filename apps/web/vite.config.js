// Haydovchilar ilovasi: oddiy statik sayt (HTML + JS). base "./" — istalgan manzil yoki papkadan ochiladi
// (haydovchilar serveri http://localhost:3001, Cloudflare Pages, GitHub Pages).
// Dasturlash rejimida (npm run web) /pub so'rovlari haydovchilar serveriga uzatiladi — uni `npm run api` bilan oching.
import react from "@vitejs/plugin-react";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

// Eski yig'ilma fayllari bir hafta saqlanadi (2026-11-27, Azimjon: «Mini App ishlamayabdi!» — bir kunda ikki marta qayta
// yig'ilganda eski index-*.js o'chib ketardi; Telegram'da ochiq turgan yoki keshlangan sahifa yo'q faylni so'rab, bo'sh
// ekran chiqishi mumkin edi). dist tozalanmaydi; assets/ dagi 7 kundan eski, yangi index.html ishlatmaydigan fayllar o'chiriladi
const KEEP_OLD_MS = 7 * 24 * 60 * 60 * 1000;
const keepOldAssets = () => ({
  name: "keep-old-assets",
  writeBundle(options, bundle) {
    const dir = path.join(options.dir, "assets");
    const fresh = new Set(Object.keys(bundle).map((f) => path.basename(f)));
    for (const file of readdirSync(dir)) {
      const full = path.join(dir, file);
      if (!fresh.has(file) && Date.now() - statSync(full).mtimeMs > KEEP_OLD_MS) unlinkSync(full);
    }
  },
});

const publicPort = Number(process.env.PUBLIC_PORT) || 3001;

export default defineConfig({
  base: "./",
  plugins: [react(), keepOldAssets()],
  build: { emptyOutDir: false },
  server: { port: 5173, proxy: { "/pub": `http://127.0.0.1:${publicPort}` } },
  preview: { port: 4173 },
});
