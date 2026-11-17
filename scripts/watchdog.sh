#!/bin/sh
# Qotib qolgan serverni qayta yoqish (2026-11-16). Jarayon qulamasa-yu, qotib qolsa (masalan, og'ir so'rov event loop'ni
# band qilsa — yuk.gtpro.uz «host err»), supervisor uni qayta yoqmaydi. Cron har 2 daqiqada ishga tushiradi:
# Mini App API (127.0.0.1:3001/pub/config) 20 s ichida javob bermasa — xato soni oshadi; ketma-ket 2 marta — qayta yoqiladi.
# O'rnatish (serverda, bir marta):  (crontab -l; echo "*/2 * * * * /data/YukPlatform/scripts/watchdog.sh") | crontab -
STATE=/tmp/yuk-watchdog.fails
LOG=/data/YukPlatform/data/watchdog.log
URL=${YUK_WATCH_URL:-http://127.0.0.1:3001/pub/config}

if curl -fsS -o /dev/null --max-time 20 "$URL"; then
  rm -f "$STATE"
  exit 0
fi
FAILS=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
echo "$FAILS" > "$STATE"
echo "$(date '+%F %T') javob yo'q ($FAILS-marta): $URL" >> "$LOG" 2>/dev/null
if [ "$FAILS" -ge 2 ]; then
  echo "$(date '+%F %T') qayta ishga tushirilyapti" >> "$LOG" 2>/dev/null
  sudo -n supervisorctl restart yuk >> "$LOG" 2>&1
  rm -f "$STATE"
fi
