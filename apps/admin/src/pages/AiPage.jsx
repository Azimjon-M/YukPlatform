// AI: hozircha faqat ko'rish — qaysi provayder va model, kalitlar yozilganmi. Boshqarish keyingi bosqichda.
import { formatNumber } from "../format.js";
import { useOverview } from "../overview.js";
import { Async, Badge, Card, PageHeader, useTitle } from "../ui.jsx";

const PROVIDERS = { gemini: "Google Gemini", claude: "Anthropic Claude" };

function KeyBadge({ ok }) {
  return (
    <Badge tone={ok ? "good" : "neutral"} icon={ok ? "✓" : "–"}>
      {ok ? "Kalit yozilgan" : "Kalit yo'q"}
    </Badge>
  );
}

export function AiPage() {
  useTitle("AI");
  const overview = useOverview();
  return (
    <>
      <PageHeader title="AI" subtitle="E'lonlarni tahlil qiladigan sun'iy intellekt" />
      <Async state={overview}>
        {({ config, metrics }) => {
          const parser = config.parser ?? {};
          const provider = parser.provider ?? "gemini";
          return (
            <div className="stack">
              <Card title="Hozirgi sozlama">
                <dl className="kv">
                  <div>
                    <dt>Provayder</dt>
                    <dd>
                      <strong>{PROVIDERS[provider] ?? provider}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{parser.model ?? "standart (PARSER_MODEL yozilmagan)"}</dd>
                  </div>
                  <div>
                    <dt>Gemini</dt>
                    <dd>
                      <KeyBadge ok={parser.keys?.gemini} />
                    </dd>
                  </div>
                  <div>
                    <dt>Claude</dt>
                    <dd>
                      <KeyBadge ok={parser.keys?.claude} />
                    </dd>
                  </div>
                  <div>
                    <dt>Oxirgi soatda tahlil</dt>
                    <dd>{formatNumber(metrics.lastHour.processed)} ta e'lon</dd>
                  </div>
                </dl>
                <p className="muted small">Kalitlarning o'zi hech qachon ko'rsatilmaydi. Hozircha sozlama .env faylida: PARSER_PROVIDER, PARSER_MODEL, GEMINI_API_KEY, ANTHROPIC_API_KEY.</p>
              </Card>
              <Card title="Keyingi bosqich">
                <p>AI kalitlarini shu yerdan boshqarish va bir nechta AI'ni parallel ishlatish keyingi bosqichda qo'shiladi.</p>
                <p className="muted small">
                  Maqsad: bir nechta kalit yoki modelni navbatga parallel qo'yib, tahlil tezligini e'lonlar oqimiga yetkazish (bosh sahifadagi grafikka qarang).
                </p>
              </Card>
            </div>
          );
        }}
      </Async>
    </>
  );
}
