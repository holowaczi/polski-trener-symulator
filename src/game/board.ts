import { LEVELS } from './data'
import type { Rng } from './rng'
import type { GameState } from './types'
import { adjustCoach, adjustTrust, club, clubLeague, formatMoney, news } from './util'
import { PRESIDENT_INFO, presidentOf } from './character'

/**
 * Prośba do prezesa o pieniądze na transfery albo większy limit pensji.
 * Decyzja zależy od relacji z zarządem, formy drużyny, miejsca w tabeli względem celu
 * i od tego, jak dawno trener ostatnio prosił.
 */
export type BoardAsk = 'transfery' | 'pensje'

/** tygodnie, które muszą minąć między prośbami */
export const ASK_COOLDOWN = 6

export interface AskOutlook {
  /** 0..100, orientacyjna szansa pokazywana graczowi jako nastrój prezesa */
  mood: number
  label: string
  waitWeeks: number
  reasons: string[]
}

function weeksSinceAsk(s: GameState): number {
  const last = s.lastAsk
  if (!last) return 99
  return (s.season - last.season) * 40 + s.round - last.round
}

/** ocena szans: to samo liczy się przy prośbie, tylko bez losowania */
export function askOutlook(s: GameState, position?: number, kind?: BoardAsk): AskOutlook {
  const reasons: string[] = []
  let mood = s.trust.board
  reasons.push(`relacje z zarządem: ${s.trust.board}/100`)
  const recent = s.streak.slice(-5)
  const form = recent.reduce((a, r) => a + (r === 'W' ? 6 : r === 'D' ? 1 : -5), 0)
  if (recent.length) {
    mood += form
    reasons.push(`forma (${recent.join('') || '–'}): ${form >= 0 ? '+' : ''}${form}`)
  }
  const lg = clubLeague(s)
  if (lg && position !== undefined && s.round > 0) {
    const size = lg.teamIds.length
    const target = s.goal === 'awans' ? 2 : s.goal === 'czołówka' ? 4 : s.goal === 'środek' ? Math.ceil(size / 2) : size - 2
    const d = position <= target ? 10 : -10
    mood += d
    reasons.push(position <= target ? 'tabela zgodna z celem: +10' : 'tabela poniżej celu: −10')
  }
  const asks = s.asksThisSeason ?? 0
  if (asks) {
    mood -= asks * 12
    reasons.push(`prośby w tym sezonie: ${asks} (−${asks * 12})`)
  }
  const pres = presidentOf(s)
  if (pres && kind) {
    const info = PRESIDENT_INFO[pres.type]
    const d = kind === 'transfery' ? info.askTransfer : info.askWages
    if (d) {
      mood += d
      reasons.push(`${info.label.toLowerCase()} ${kind === 'transfery' ? 'i transfery' : 'i pensje'}: ${d > 0 ? '+' : ''}${d}`)
    }
  }
  const since = weeksSinceAsk(s)
  const waitWeeks = Math.max(0, ASK_COOLDOWN - since)
  mood = Math.max(0, Math.min(100, Math.round(mood)))
  const label = mood >= 75 ? 'Prezes w dobrym humorze' : mood >= 55 ? 'Prezes się waha' : mood >= 35 ? 'Prezes raczej odmówi' : 'Prezes nie odbierze telefonu'
  return { mood, label, waitWeeks, reasons }
}

export function askBoard(rng: Rng, s: GameState, kind: BoardAsk, position?: number): string {
  const t = club(s)
  if (!t) return ''
  const o = askOutlook(s, position, kind)
  if (o.waitWeeks > 0) {
    adjustTrust(s, { board: -4 })
    return `Prezes: „Panie trenerze, przecież dopiero co rozmawialiśmy”. Wróć za ${o.waitWeeks} ${o.waitWeeks === 1 ? 'tydzień' : 'tygodnie'}. Zarząd jest poirytowany.`
  }
  s.lastAsk = { season: s.season, round: s.round }
  s.asksThisSeason = (s.asksThisSeason ?? 0) + 1
  const roll = o.mood + rng.normal(0, 10)
  const lv = LEVELS[t.level]
  if (roll >= 55) {
    const full = roll >= 75
    if (kind === 'transfery') {
      const amount = Math.round((lv.budget * (full ? 0.3 : 0.15)) / 100) * 100
      s.budget += amount
      adjustTrust(s, { board: -3 })
      const msg = full
        ? `Prezes wyciąga książeczkę czekową: ${formatMoney(amount)} na transfery. „Tylko żeby to było widać na boisku”.`
        : `Prezes daje ${formatMoney(amount)} na transfery. „Więcej nie ma, sprzedałem już nawet przyczepę”.`
      news(s, msg)
      return msg
    }
    const raise = Math.round((s.wageLimit * (full ? 0.12 : 0.06)) / 100) * 100
    s.wageLimit += raise
    adjustTrust(s, { board: -3 })
    const msg = `Limit pensji rośnie o ${formatMoney(raise)}/mies. ${full ? 'Prezes: „Inwestujemy w ludzi”.' : 'Prezes: „Ale to ostatni raz w tej rundzie”.'}`
    news(s, msg)
    return msg
  }
  adjustTrust(s, { board: -2 })
  adjustCoach(s, { stress: 3 })
  const no = [
    'Prezes: „Pieniądze są, ale na wynik. Najpierw wynik”.',
    'Prezes słucha, kiwa głową i zmienia temat na pogodę. Nie będzie pieniędzy.',
    'Prezes pokazuje Ci zeszyt z wydatkami klubu. Odmowa.',
    'Prezes: „Trenerze, a może by tak z tym, co mamy?”.',
  ]
  return rng.pick(no)
}
