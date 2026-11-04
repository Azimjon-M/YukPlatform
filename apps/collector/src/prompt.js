// Terminaldan javob so'rash.
// Yashirin kiritish (parol) uchun readline'ning ichki _writeToOutput usuli ishlatilmaydi:
// Node 24 dagi readline/promises'da u yo'q. O'rniga terminal "raw" rejimga o'tkaziladi
// va har bir bosilgan tugma qo'lda o'qiladi.
import { createInterface } from "node:readline/promises";

export async function ask(question, { hidden = false, input = process.stdin, output = process.stdout } = {}) {
  if (hidden && input.isTTY) return askHidden(question, { input, output });
  const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

// Yozilgan har bir belgi o'rniga "*" chiqadi. Enter — tugatish, Backspace — o'chirish, Ctrl+C — bekor qilish.
export function askHidden(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") return finish(new Error("Bekor qilindi (Ctrl+C)"));
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
        } else if (ch >= " ") {
          value += ch;
          output.write("*");
        }
      }
    };
    output.write(question);
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
  });
}
