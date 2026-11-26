// 🔒 Majburiy a'zolik (Azimjon, 2026-11-26: «majburiy kanal/guruhlarni Dashboardga qo'shsak: men telegram link qo'shaman,
// botni unga admin qilaman — bot o'sha guruh/kanalda bo'lmasa ishlamasin — va u majburiy a'zolikka qo'shilsin»).
// Bot faqat shu kanal/guruhlar a'zolariga ishlaydi, ilovaga kirish (kod / bot orqali) ham. O'zgarish botda ~20 s da,
// ilova serverida darhol kuchga kiradi. Server qo'shishdan oldin tekshiradi: chat bormi va bot u yerda adminmi.
import { useState } from "react";
import { del, get, post } from "../api.js";
import { formatDateTime } from "../format.js";
import { useApi } from "../hooks.js";
import { Async, Badge, Button, Card, Empty, ExternalLink, Field, PageHeader, useTitle, useToast } from "../ui.jsx";

function AddChat({ onAdded, full }) {
  const notify = useToast();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!link.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await post("/api/required-chats", { link: link.trim() });
      notify("Qo'shildi — endi bot faqat a'zolarga ishlaydi", "good");
      setLink("");
      onAdded(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="➕ Kanal yoki guruh qo'shish">
      <form className="add-source" onSubmit={submit}>
        <Field label="Telegram havolasi" className="field-grow">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://t.me/Yuk_Ekspert, @Yuk_Ekspert yoki -1001234567890"
            autoComplete="off"
            spellCheck="false"
            aria-invalid={error ? true : undefined}
            disabled={full}
            required
          />
        </Field>
        <Button type="submit" variant="primary" busy={busy} disabled={!link.trim() || full}>
          Qo'shish
        </Button>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">
        Avval botni o'sha kanal/guruhga qo'shib, <b>admin</b> qiling — admin bo'lmasa Telegram boshqalarning a'zoligini aytmaydi va qo'shib bo'lmaydi.
        Yopiq kanal uchun taklif havolasi (t.me/+…) ishlamaydi — -100… ID sini yozing.
      </p>
    </Card>
  );
}

function ChatRow({ chat, onRemoved }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!window.confirm(`«${chat.title}» majburiy a'zolikdan olib tashlansinmi?`)) return;
    setBusy(true);
    try {
      onRemoved(await del(`/api/required-chats/${encodeURIComponent(chat.ref)}`));
      notify("Olib tashlandi", "neutral");
    } catch (e) {
      notify(e.message, "critical");
      setBusy(false);
    }
  }
  return (
    <li className="row-item required-row">
      <div className="row-main">
        <strong>{chat.type === "channel" ? "📢" : chat.type === "group" ? "💬" : "🔒"} {chat.title}</strong>
        <div className="muted small">
          {chat.url ? <ExternalLink href={chat.url}>{chat.ref}</ExternalLink> : chat.ref}
          {chat.addedAt ? ` · qo'shilgan: ${formatDateTime(chat.addedAt)}` : ""}
        </div>
      </div>
      <Button variant="danger" busy={busy} onClick={remove}>
        Olib tashlash
      </Button>
    </li>
  );
}

export function RequiredChatsPage() {
  useTitle("A'zolik");
  const state = useApi(() => get("/api/required-chats"), []);
  const apply = () => state.reload();

  return (
    <>
      <PageHeader
        title="🔒 Majburiy a'zolik"
        subtitle="Bot va ilovaga kirish faqat shu kanal/guruhlar a'zolariga. O'zgarish botda ~20 soniyada kuchga kiradi."
        actions={<Button onClick={() => state.reload()}>Yangilash</Button>}
      />
      <div className="stack">
        <Async state={state}>
          {(data) => (
            <>
              <AddChat onAdded={apply} full={data.items.length >= data.max} />
              <Card
                title={`Ro'yxat (${data.items.length}/${data.max})`}
                actions={data.source === "env" && data.items.length ? <Badge tone="neutral">.env REQUIRED_CHATS dan</Badge> : null}
              >
                {data.items.length === 0 ? (
                  <Empty title="Majburiy a'zolik yo'q">
                    <p>Bot hammaga ishlaydi. Kanal yoki guruh qo'shsangiz — faqat ularning a'zolariga.</p>
                  </Empty>
                ) : (
                  <ul className="rows">
                    {data.items.map((chat) => (
                      <ChatRow key={chat.ref} chat={chat} onRemoved={apply} />
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </Async>
      </div>
    </>
  );
}
