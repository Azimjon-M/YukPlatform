// elonlar.txt faylini alohida e'lonlarga bo'ladi.
// Ajratuvchi — alohida qatordagi kamida 3 ta chiziqcha: ---
export function splitPosts(text) {
  return text
    .split(/^[ \t]*-{3,}[ \t]*$/m)
    .map((post) => post.trim())
    .filter(Boolean);
}
