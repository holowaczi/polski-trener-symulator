/** Deterministyczny generator (mulberry32). Stan trzymany w GameState, więc zapis gry odtwarza losowość. */
export class Rng {
  state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  /** rozkład Poissona (Knuth) */
  poisson(lambda: number): number {
    const l = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= this.next()
    } while (p > l)
    return k - 1
  }

  /** przybliżenie rozkładu normalnego */
  normal(mean: number, sd: number): number {
    const u = this.next() + this.next() + this.next() + this.next() - 2
    return mean + u * sd * 1.22
  }
}

export function seedFromString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
