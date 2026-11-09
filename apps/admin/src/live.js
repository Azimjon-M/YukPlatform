// Jonli yangilanish (server: apps/api/src/live.js, GET /api/live — Server-Sent Events).
// Butun panelga BITTA ulanish. Server «drivers», «posts», «loads», «ai», «sources», «processes», «logs» dan qaysi biri
// o'zgarganini aytadi — o'sha bo'limni ko'rsatib turgan sahifa uni qayta so'raydi (hooks.js useApi { live: [...] }).
// Ulanish uzilsa brauzer o'zi qayta ulanadi; qayta ulanganda hamma sahifa bir marta yangilanadi (uzilishda nima o'zgargani noma'lum).

const subscribers = new Set(); // { topics: Set | null, fn }
const statusSubscribers = new Set();
let source = null;
let status = "connecting"; // connecting | live | offline
let lost = false;
let retryTimer = null;

export const liveStatus = () => status;

function setStatus(next) {
  if (next === status) return;
  status = next;
  for (const fn of statusSubscribers) fn(status);
}

// topics — o'zgargan bo'limlar; null — hammasi (qayta ulanish)
export function emitTopics(topics) {
  for (const { topics: wanted, fn } of subscribers) {
    if (topics === null || wanted === null || topics.some((t) => wanted.has(t))) fn(topics);
  }
}

function connect() {
  if (source || typeof EventSource === "undefined") return;
  clearTimeout(retryTimer);
  source = new EventSource("/api/live");
  source.addEventListener("ready", () => {
    setStatus("live");
    if (lost) emitTopics(null);
    lost = false;
  });
  source.addEventListener("change", (event) => {
    try {
      const { topics } = JSON.parse(event.data);
      if (Array.isArray(topics) && topics.length) emitTopics(topics);
    } catch {
      // tushunarsiz xabar — e'tibor bermaymiz
    }
  });
  source.addEventListener("error", () => {
    lost = true;
    if (source.readyState === EventSource.CLOSED) {
      // Server 404/500 qaytardi (masalan, eski versiya) — brauzer o'zi qayta urinmaydi, biz 10 s dan keyin
      source = null;
      setStatus("offline");
      retryTimer = setTimeout(connect, 10_000);
    } else {
      setStatus("connecting"); // brauzer o'zi qayta ulanadi (retry: 3000)
    }
  });
}

// fn(topics) — ro'yxatdagi bo'limlardan biri o'zgarganda (topics: null — hammasi). → obunani bekor qilish
export function subscribeLive(topics, fn) {
  const entry = { topics: topics ? new Set(topics) : null, fn };
  subscribers.add(entry);
  connect();
  return () => subscribers.delete(entry);
}

export function subscribeLiveStatus(fn) {
  statusSubscribers.add(fn);
  connect();
  return () => statusSubscribers.delete(fn);
}
