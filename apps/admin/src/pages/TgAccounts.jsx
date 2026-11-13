// Collector'ning Telegram akkauntlari (2026-11-13): yopiq guruhni faqat unga a'zo akkaunt o'qiy oladi.
// Bu yerda — akkauntlar holati, ularning guruhlari ro'yxatidan yopiq guruhni manba qilib qo'shish.
// Akkauntga kirish (kod, 2FA) shu sahifada YO'Q: uni akkaunt egasi serverda terminalda o'zi qiladi (tg:login).
import { useState } from "react";
import { get, post } from "../api.js";
import { dialogSource, formatNumber, loginCommand, MAIN_TG_ACCOUNT, pickableDialogs, tgAccountView } from "../format.js";
import { useApi } from "../hooks.js";
import { Badge, Button, Card, Field, TimeAgo, useToast } from "../ui.jsx";

const SHOW = 30; // ro'yxatda birdaniga ko'rsatiladigan guruhlar (qolgani — qidiruv bilan)
const accountLabel = (name) => (name === MAIN_TG_ACCOUNT ? "asosiy" : name);
const who = (a) => [a.firstName, a.username ? `@${a.username}` : null].filter(Boolean).join(" ") || (a.userId ? `id ${a.userId}` : "—");

// SourcesPage ikkala kartaga bitta so'rov beradi (akkaunt holati manba qatorida ham kerak)
export function useTgAccounts() {
  return useApi(() => get("/api/tg-accounts"), [], { live: ["sources", "processes"], liveGapMs: 3000 });
}

function AccountRow({ account, now }) {
  const view = tgAccountView(account);
  return (
    <li className="tg-account">
      <div className="source-name">
        <strong>{accountLabel(account.name)}</strong>
        <span className="muted small">{who(account)}</span>
        <Badge tone={view.tone} icon={view.icon} title={view.title}>
          {view.label}
        </Badge>
      </div>
      <p className="muted small">
        {formatNumber(account.dialogs)} ta guruh/kanalga a'zo · {formatNumber(account.sources)} ta manbani o'qiydi
        {account.dialogsAt ? (
          <>
            {" "}
            · ro'yxat <TimeAgo ts={account.dialogsAt} now={now} />
          </>
        ) : null}
      </p>
      {/* Collector xatosida qanday kirish allaqachon yozilgan bo'lsa — maslahat takrorlanmaydi */}
      {view.hint && !(account.error ?? "").includes("tg:login") && <p className="small">{view.hint}</p>}
      {account.error && account.status !== "ok" && <p className="inline-error small">{account.error}</p>}
    </li>
  );
}

export function TgAccountsCard({ state, now }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const data = state.data;
  const collector = data?.collector?.status;
  const stopped = collector && !["running", "external"].includes(collector);

  async function refresh() {
    setBusy(true);
    try {
      await post("/api/tg-accounts/refresh");
      notify("Collector har akkauntning guruhlar ro'yxatini 1 daqiqa ichida yangilaydi", "good");
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Telegram akkauntlari"
      actions={
        data && (
          <Button onClick={refresh} busy={busy} title="Akkaunt yangi guruhga qo'shilgan bo'lsa">
            Ro'yxatni yangilash
          </Button>
        )
      }
    >
      {!data ? (
        state.error?.status === 404 ? (
          <p className="muted small">Server yangi kodni qayta ishga tushirilgandan keyin ko'rsatadi.</p>
        ) : state.error ? (
          <p className="inline-error small">{state.error.message}</p>
        ) : (
          <p className="muted small">Yuklanmoqda…</p>
        )
      ) : (
        <div className="stack-sm">
          {stopped && (
            <div className="notice tone-warning" role="status">
              <span aria-hidden="true">!</span> Collector ishlamayapti — quyidagi holatlar u to'xtagan paytdagisi.
            </div>
          )}
          {data.accounts.length === 0 ? (
            <p className="muted small">Collector hali hech bir akkaunt haqida yozmagan (yangi kod bilan ishga tushgach ko'rinadi).</p>
          ) : (
            <ul className="tg-account-list">
              {data.accounts.map((account) => (
                <AccountRow key={account.name} account={account} now={now} />
              ))}
            </ul>
          )}
          {data.orphans?.length > 0 && (
            <p className="inline-error small">
              Manbalarga biriktirilgan, lekin ulanmagan akkaunt: {data.orphans.join(", ")} — ularning guruhlari o'qilmayapti.
            </p>
          )}
          <details className="help-card tg-howto">
            <summary>
              <h2>Yopiq guruh uchun akkaunt qo'shish</h2>
              <span className="muted small help-hint">ochish uchun bosing</span>
            </summary>
            <ol className="plain-list">
              <li>
                Alohida raqamdagi Telegram akkaunt oling (shaxsiy akkaunt emas). Yopiq guruh a'zosi (masalan, haydovchi do'stingiz) shu akkauntni guruhga
                qo'shsin.
              </li>
              <li>
                Serverda, loyiha papkasida, terminalda: <code>{loginCommand("ikkinchi")}</code> (nom — o'zingiz tanlaysiz: kichik lotin harflari). Kodni va 2FA
                parolni <strong>akkaunt egasining o'zi</strong> terminalga yozadi — ularni hech kimga, hech qanday botga yoki chatga yubormang.
              </li>
              <li>Ishlab turgan collector yangi akkauntni 30 soniya ichida o'zi ulaydi — shu yerda paydo bo'ladi. Qayta ishga tushirish shart emas.</li>
              <li>Pastdagi «Yopiq guruh qo'shish» ro'yxatidan guruhni tanlang. Shu akkaunt uni o'qiydi, e'lonlar boshqa guruhlarnikidek haydovchilarga boradi.</li>
              <li>
                Akkauntni o'chirish: <code>npm run tg:logout -- --account ikkinchi</code>. Har akkaunt Telegram'ga o'z sur'atida so'rov yuboradi; ko'p
                akkaunt — ko'p tekshiruv emas, faqat yopiq guruhlar uchun.
              </li>
            </ol>
          </details>
        </div>
      )}
    </Card>
  );
}

export function PrivateGroupPicker({ state, onAdded }) {
  const notify = useToast();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(null);
  const data = state.data;
  if (!data || data.accounts.length === 0) return null;
  const list = pickableDialogs(data.dialogs, data.accounts, query);

  async function add(dialog) {
    const source = dialogSource(dialog);
    setBusy(dialog.peerId);
    try {
      const result = await post("/api/sources", source);
      notify(result.added ? `«${dialog.title}» qo'shildi — collector bir necha soniyada o'qiy boshlaydi` : `«${dialog.title}» ro'yxatda allaqachon bor`, result.added ? "good" : "neutral");
      onAdded();
    } catch (e) {
      notify(e.message, "critical");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Yopiq guruh qo'shish">
      <p className="muted small">
        Akkauntlar a'zo bo'lgan, hali manba bo'lmagan guruh va kanallar. 🔒 Yopiq — faqat a'zo akkaunt o'qiydi; 🌐 ochig'ini asosiy akkaunt a'zo
        bo'lmasdan ham o'qiydi.
      </p>
      <Field label="Qidirish" className="field-grow">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Guruh nomi, @manzil yoki id" autoComplete="off" spellCheck="false" />
      </Field>
      {list.length === 0 ? (
        <p className="muted small">{query ? "Topilmadi." : "Qo'shiladigan guruh yo'q: akkaunt yangi guruhga qo'shilgan bo'lsa, «Ro'yxatni yangilash» ni bosing."}</p>
      ) : (
        <ul className="dialog-list">
          {list.slice(0, SHOW).map((dialog) => (
            <li key={dialog.peerId} className="dialog-row">
              <div className="source-main">
                <div className="source-name">
                  <span aria-hidden="true">{dialog.username ? "🌐" : "🔒"}</span>
                  <strong>{dialog.title || dialog.peerId}</strong>
                </div>
                <p className="muted small">
                  {dialog.username ? `@${dialog.username}` : `yopiq ${dialog.type ?? "guruh"} · ${dialog.peerId}`}
                  {dialog.members ? ` · ${formatNumber(dialog.members)} a'zo` : ""} · akkaunt: {dialog.accounts.map(accountLabel).join(", ")}
                </p>
              </div>
              <Button onClick={() => add(dialog)} busy={busy === dialog.peerId} disabled={busy != null && busy !== dialog.peerId}>
                Qo'shish
              </Button>
            </li>
          ))}
        </ul>
      )}
      {list.length > SHOW && <p className="muted small">Yana {formatNumber(list.length - SHOW)} ta — qidiruv bilan toping.</p>}
    </Card>
  );
}
