// «Siz kimsiz?» — haydovchi yoki yuk beruvchi. Botdagi /rol bilan bir xil: har rolning sozlamalari alohida saqlanadi,
// avval to'ldirilgan rolga qaytilsa — sozlamalari tiklanadi (server: store.switchRole).
import { ROLES, ROLE_IDS } from "@yuk/shared";

// current — hozirgi rol (almashtirishda) yoki null (birinchi marta); onPick(role); onCancel — faqat almashtirishda
export function RolePage({ current, busy, onPick, onCancel }) {
  return (
    <div className="roles">
      <h2>{current ? "Rolni almashtirish" : "Siz kimsiz?"}</h2>
      <p className="lead">
        {current
          ? "Har rolning sozlamalari alohida saqlanadi — qaytib kelsangiz, qaytadan kiritish shart emas."
          : "Shunga qarab katta yuk guruhlaridagi e'lonlardan sizga keraklisini saralab yuboramiz."}
      </p>
      {ROLE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className={`role-card${current === id ? " on" : ""}`}
          aria-pressed={current === id}
          disabled={busy}
          onClick={() => onPick(id)}
        >
          <span className="role-icon" aria-hidden="true">
            {ROLES[id].icon}
          </span>
          <span>
            {/* "🚚 Haydovchiman — yuk qidiraman" → belgisiz */}
            <strong>{ROLES[id].choice.replace(/^\S+\s/, "")}</strong>
            <small>Sizga {ROLES[id].gets} keladi</small>
          </span>
        </button>
      ))}
      {onCancel && (
        <button type="button" className="link" onClick={onCancel}>
          Bekor qilish
        </button>
      )}
    </div>
  );
}
