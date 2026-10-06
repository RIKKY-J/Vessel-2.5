const ADJECTIVES = ["neon", "hyper", "turbo", "cosmic", "flux", "orbit", "vertex", "swift", "pulse", "cyber"];
const NOUNS = ["runner", "node", "python", "cloud", "prism", "shadow", "spark", "forge", "pilot", "core"];

export function generateReplId(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const mid = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${mid}-${noun}`;
}
