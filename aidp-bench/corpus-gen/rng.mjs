// Seeded deterministic RNG (mulberry32) + helpers. The whole corpus regenerates byte-identically
// from the seed; never use Math.random/Date.now in generation code.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(str) { // stable string -> uint32
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export class Rng {
  constructor(seedStr) { this.f = mulberry32(hashSeed(seedStr)); }
  next() { return this.f(); }
  int(min, max) { return min + Math.floor(this.f() * (max - min + 1)); } // inclusive
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  chance(p) { return this.f() < p; }
  shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  digits(n) { let s = ''; for (let i = 0; i < n; i++) s += this.int(0, 9); return s; }
  money(min, max) { return Math.round((min + this.f() * (max - min)) * 100) / 100; }
}
