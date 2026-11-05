// Sinov uchun soxta bot: qator chiqaradi, "stop" kelsa yumshoq tugaydi; "crash" — darhol xato bilan, "stubborn" — stop'ni e'tiborsiz qoldiradi
const mode = process.argv[2] ?? "ok";
if (!process.send) process.exit(0); // test sifatida to'g'ridan-to'g'ri ochilsa — darhol tugaydi
process.stdout.write("salom ");
process.stdout.write("dunyo\nikkinchi qator\n");
console.error("ogohlantirish");
if (mode === "crash") process.exit(3);
process.on("message", (message) => {
  if (message !== "stop" || mode === "stubborn") return;
  console.log("to'xtayapman");
  process.exit(0);
});
setInterval(() => {}, 1000);
