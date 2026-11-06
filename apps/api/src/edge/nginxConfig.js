// nginx sozlamasi (matn). nginx — kompyuterning «old eshigi»: internetdan (tunnel orqali) kelgan har bir so'rov
// avval shunga keladi. U:
//   - haydovchilar ilovasining fayllarini (apps/web/dist) o'zi beradi — tez, siqib (gzip), keshlab;
//   - /pub/ so'rovlarini haydovchilar serveriga (3001) uzatadi (reverse proxy);
//   - boshqaruv markazini (3000) HECH QACHON ochmaydi: unga bu yerda yo'l yo'q.
// Bot va collector nginx'dan o'tmaydi: ular o'zlari Telegram'ga ulanadi.
// Keyin serverga (VPS) ko'chganda ham xuddi shu sozlama ishlatiladi — faqat yo'llar va https qo'shiladi.

// Windows yo'li → nginx yo'li: teskari chiziq o'rniga to'g'ri chiziq (nginx ikkalasini ham tushunadi, lekin \ escape bo'ladi)
export const nginxPath = (value) => value.replace(/\\/g, "/");

// listen — faqat shu kompyuter (127.0.0.1): tarmoqdan ochilmaydi, Windows Firewall ham so'ramaydi. Tunnel shu yerga ulanadi.
export function nginxConfig({ port = 80, publicPort = 3001, webDist, mimeTypes, host = "127.0.0.1" }) {
  if (!webDist || !mimeTypes) throw new Error("nginxConfig: webDist va mimeTypes kerak");
  // Statik fayllar uchun xavfsizlik sarlavhalari. X-Frame-Options QO'YILMAYDI: Telegram Web Mini App'ni iframe ichida ochadi.
  // add_header location ichida yozilsa, yuqoridagilar meros o'tmaydi — shuning uchun har bir location'da takrorlanadi.
  const secure = [`add_header X-Content-Type-Options "nosniff" always;`, `add_header Referrer-Policy "strict-origin-when-cross-origin" always;`];
  const lines = (items, pad) => items.map((line) => `${pad}${line}`).join("\n");

  return `# Avtomatik yaratilgan: apps/api/src/edge/nginxConfig.js — bu faylni qo'lda o'zgartirmang (har ishga tushganda qayta yoziladi)
worker_processes 1;
# Xatolar faylga; nginx.js uni kuzatib, boshqaruv markazidagi logga chiqaradi (Windows'da ishchi jarayon stderr'ga yozmaydi)
error_log logs/error.log warn;
pid logs/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include "${nginxPath(mimeTypes)}";
    default_type application/octet-stream;
    charset utf-8;
    server_tokens off;
    sendfile on;
    keepalive_timeout 65;

    access_log logs/access.log combined buffer=32k flush=10s;

    client_body_temp_path temp/client_body;
    proxy_temp_path temp/proxy;
    fastcgi_temp_path temp/fastcgi;
    uwsgi_temp_path temp/uwsgi;
    scgi_temp_path temp/scgi;

    # Matnli fayllarni siqib yuboradi: JS ~420 KB → ~135 KB (sekin mobil internetda sezilarli)
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_proxied any;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    # Haydovchilar serveri (apps/api public.js)
    upstream yuk_public {
        server 127.0.0.1:${publicPort};
        keepalive 8;
    }

    server {
        listen ${host}:${port} default_server;
        server_name _;
        root "${nginxPath(webDist)}";
        client_max_body_size 64k;

        # Boshqaruv markazi bu eshikdan ochilmaydi
        location ^~ /admin { return 404; }
        location ^~ /api/ { return 404; }

        # API: Telegram orqali kirish, yuklar, profil. cf-connecting-ip (haqiqiy manzil) tunneldan o'zgarishsiz o'tadi
        location ^~ /pub/ {
            proxy_pass http://yuk_public;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_read_timeout 30s;
        }

        # Nomida xesh bor fayllar (index-AbC123.js): o'zgarmaydi — telefon bir hafta saqlaydi
        location ^~ /assets/ {
${lines([`add_header Cache-Control "public, max-age=604800, immutable" always;`, ...secure], "            ")}
            try_files $uri =404;
        }

        # Qolgan hamma yo'l — ilovaning o'zi (index.html har safar yangidan tekshiriladi)
        location / {
${lines([`add_header Cache-Control "no-cache" always;`, ...secure], "            ")}
            try_files $uri /index.html =404;
        }
    }
}
`;
}
