// Bitta yuk (haydovchiga) yoki bo'sh mashina (yuk beruvchiga): qayerdan → qayerga, tafsilotlar,
// telefon (bosilsa qo'ng'iroq), asl e'lon. Matnlar bot xabaridagi bilan bir xil (@yuk/shared loadText.js).
import { agoText, cargoText, phoneText, placeText, priceText, truckPlaceText, truckVehicleText, vehicleText } from "@yuk/shared";
import { openLink } from "./telegram.js";

function Route({ from, to }) {
  return (
    <h3 className="route">
      <span>{from}</span>
      <span className="arrow" aria-label="dan">
        →
      </span>
      <span>{to}</span>
    </h3>
  );
}

// Ikkala kartochkaning pastki qismi: telefonlar, asl e'lon, qachon va qayerda chiqqani
function Contacts({ load, post, now }) {
  const phones = (load.phones ?? []).map(phoneText);
  const source = post.source?.startsWith("@") ? post.source : null;
  return (
    <>
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
    </>
  );
}

export function LoadCard({ item, now }) {
  const { load, post } = item;
  const cargo = cargoText(load);
  const vehicle = vehicleText(load);
  return (
    <article className="load">
      <Route from={placeText(load, "from")} to={placeText(load, "to")} />
      {cargo && <p>📦 {cargo}</p>}
      {vehicle && <p>🚚 {vehicle}</p>}
      <p className={load.price != null ? "price" : "muted"}>💰 {priceText(load)}</p>
      {load.when && <p>📅 {load.when}</p>}
      {load.note && <p className="muted">📝 {load.note}</p>}
      <Contacts load={load} post={post} now={now} />
    </article>
  );
}

// Bo'sh mashina: "qayerga" yozilmagan bo'lsa — istalgan joyga; narx ko'pincha yo'q (bo'lsa ko'rsatiladi)
export function TruckCard({ item, now }) {
  const { load: truck, post } = item;
  const vehicle = truckVehicleText(truck);
  return (
    <article className="load">
      <Route from={truckPlaceText(truck, "from")} to={truckPlaceText(truck, "to")} />
      {vehicle && <p>🚛 {vehicle}</p>}
      {(truck.price != null || truck.negotiable) && <p className="price">💰 {priceText(truck)}</p>}
      {truck.when && <p>📅 {truck.when}</p>}
      {truck.note && <p className="muted">📝 {truck.note}</p>}
      <Contacts load={truck} post={post} now={now} />
    </article>
  );
}
