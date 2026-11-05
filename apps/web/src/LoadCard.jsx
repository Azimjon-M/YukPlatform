// Bitta yuk: qayerdan → qayerga, yuk, mashina, narx, telefon (bosilsa qo'ng'iroq), asl e'lon.
// Matnlar bot xabaridagi bilan bir xil (@yuk/shared loadText.js).
import { agoText, cargoText, phoneText, placeText, priceText, vehicleText } from "@yuk/shared";
import { openLink } from "./telegram.js";

export function LoadCard({ item, now }) {
  const { load, post } = item;
  const cargo = cargoText(load);
  const vehicle = vehicleText(load);
  const phones = (load.phones ?? []).map(phoneText);
  const source = post.source?.startsWith("@") ? post.source : null;
  return (
    <article className="load">
      <h3 className="route">
        <span>{placeText(load, "from")}</span>
        <span className="arrow" aria-label="dan">
          →
        </span>
        <span>{placeText(load, "to")}</span>
      </h3>
      {cargo && <p>📦 {cargo}</p>}
      {vehicle && <p>🚚 {vehicle}</p>}
      <p className={load.price != null ? "price" : "muted"}>💰 {priceText(load)}</p>
      {load.when && <p>📅 {load.when}</p>}
      {load.note && <p className="muted">📝 {load.note}</p>}
      <div className="actions">
        {phones.map((phone) => (
          <a key={phone} className="call" href={`tel:${phone}`}>
            📞 {phone}
          </a>
        ))}
        {post.link && (
          <a className="source" href={post.link} target="_blank" rel="noopener noreferrer" onClick={(e) => openLink(post.link, e)}>
            Asl e'lon
          </a>
        )}
      </div>
      {!phones.length && <p className="muted small">Telefon yozilmagan — asl e'lonni oching.</p>}
      <p className="meta">
        <time dateTime={new Date(post.postedAt).toISOString()}>{agoText(post.postedAt, now)}</time>
        {source && ` · ${source}`}
      </p>
    </article>
  );
}
