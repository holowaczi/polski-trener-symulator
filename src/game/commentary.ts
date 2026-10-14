import type { Rng } from './rng'

interface Ctx {
  level: number
  myGoals: number
  oppGoals: number
  myTeam: string
  oppTeam: string
  xiNames: string[]
  goals: { minute: number; mine: boolean; name: string }[]
}

const LOW_LEVEL = [
  'Mecz opóźniony o 20 minut, bo sędzia utknął za kombajnem.',
  'W przerwie gospodarze sprzedali wszystkie kiełbasy. Rekord frekwencji: 112 osób.',
  'Piłka wpadła do rowu melioracyjnego. Szukano jej 6 minut.',
  'Pies kibica wbiegł na boisko i był najaktywniejszy w drugiej połowie.',
  'Bramkarz gości grał w kaloszach, bo korki zostały w busie.',
  'Sędzia liniowy to wujek jednego z zawodników. Nikt nie protestował.',
  'Na trybunie ktoś grillował. Zapach skutecznie dekoncentrował obronę.',
  '{x} grał po nocnej zmianie w zakładzie. Widać było.',
  'Krowy z sąsiedniego pastwiska obejrzały całe spotkanie bez emocji.',
  'Murawa po deszczu przypominała ryżowe pole. Technika nie miała znaczenia.',
]

const MID_LEVEL = [
  'Spiker trzykrotnie przekręcił nazwisko {x}.',
  'Kibice gości przyjechali pociągiem. Spóźnionym, oczywiście.',
  'Transmisja na Facebooku urwała się w 60. minucie. Komentarze: „co jest?”.',
  'Trener rywali wyleciał na trybuny za rzucenie butelką wody w kierunku nikogo.',
  '{x} wykonał wrzut z autu tak daleki, że niektórzy zaczęli bić brawo.',
  'Na trybunach oprawa: transparent „Nawet w deszczu z wami”. Padało.',
]

const HIGH_LEVEL = [
  'VAR analizował sytuację 4 minuty. Nikt nadal nie wie, co sprawdzał.',
  'Ekspert w studiu nazwał akcję „nie do obronienia”, a potem i tak ją obronił.',
  'Kibice wywiesili sektorówkę, która zasłoniła pół boiska realizatorowi.',
  '{x} biegał tak dużo, że aplikacja do GPS się zawiesiła.',
  'Prezes po meczu udzielił wywiadu dłuższego niż sam mecz.',
]

const WIN = [
  'Szatnia śpiewa. Kierownik drużyny gubi klucze do autokaru z radości.',
  'Prezes stawia pizzę. Hawajską, ale nikt nie narzeka.',
  'Kibice skandują nazwisko trenera. Prawie dobrze.',
]
const LOSS = [
  'W szatni cisza. Słychać tylko, jak kapie prysznic.',
  'Prezes wyszedł w 75. minucie. „Na pociąg”, jak twierdzi.',
  'Kibice zaśpiewali „Nic się nie stało”, ale bez przekonania.',
]
const DRAW = ['Remis, który nikogo nie cieszy, ale też nikogo nie zwalnia.', 'Punkt to punkt, jak mówi stare przysłowie trenerskie.']
const BIG_WIN = ['Takiego pogromu nie było tu od czasów, gdy grał jeszcze wujek prezesa.']
const BIG_LOSS = ['Bramkarz po meczu poprosił o zmianę nazwiska w protokole.']

export function commentary(rng: Rng, c: Ctx): string[] {
  const pool = c.level <= 2 ? LOW_LEVEL : c.level <= 5 ? MID_LEVEL : HIGH_LEVEL
  const lines: string[] = []
  const x = () => rng.pick(c.xiNames.length ? c.xiNames : ['ktoś'])
  const n = rng.int(1, 2)
  const used = new Set<string>()
  for (let i = 0; i < n; i++) {
    const line = rng.pick(pool)
    if (used.has(line)) continue
    used.add(line)
    lines.push(line.replace('{x}', x()))
  }
  const diff = c.myGoals - c.oppGoals
  if (diff >= 4) lines.push(rng.pick(BIG_WIN))
  else if (diff <= -4) lines.push(rng.pick(BIG_LOSS))
  else if (diff > 0) lines.push(rng.pick(WIN))
  else if (diff < 0) lines.push(rng.pick(LOSS))
  else lines.push(rng.pick(DRAW))
  return lines
}
