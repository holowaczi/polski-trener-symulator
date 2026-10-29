import { FIRST_NAMES, LAST_NAMES } from './data'
import { paperFor } from './endings'
import type { Rng } from './rng'
import type { GameState, Player, Team } from './types'
import { adjustTrust, news, setMorale } from './util'

// ---------- prezes z charakterem ----------

export type PresidentType = 'biznesmen' | 'samorzadowiec' | 'pilkarz' | 'masarnia'

export interface President {
  teamId: number
  name: string
  type: PresidentType
}

export const PRESIDENT_INFO: Record<
  PresidentType,
  {
    label: string
    desc: string
    /** poniżej tylu punktów relacji z zarządem prezes zwalnia */
    fireAt: number
    /** nastrój przy prośbie o pieniądze na transfery i o wyższy limit pensji */
    askTransfer: number
    askWages: number
    /** jak mocno wynik meczu rusza relacjami z zarządem */
    resultWeight: number
    /** ile humoru kibiców przechodzi na zarząd */
    fansWeight: number
  }
> = {
  biznesmen: {
    label: 'Biznesmen',
    desc: 'Liczy wszystko w Excelu, także Twoje zwycięstwa. Chętnie dokłada do transferów, jak widzi zwrot, ale cierpliwość kończy mu się szybciej niż kwartał.',
    fireAt: 16,
    askTransfer: 10,
    askWages: -5,
    resultWeight: 1.2,
    fansWeight: 0,
  },
  samorzadowiec: {
    label: 'Samorządowiec',
    desc: 'Klub to wizytówka gminy, a do wyborów daleko, więc jest cierpliwy. Pieniądze ma z dotacji, czyli nie ma. Najbardziej słucha tego, co mówią kibice, bo to też wyborcy.',
    fireAt: 8,
    askTransfer: -8,
    askWages: -8,
    resultWeight: 0.8,
    fansWeight: 0.35,
  },
  pilkarz: {
    label: 'Były piłkarz',
    desc: 'Grał kiedyś w lidze i wie lepiej. Każdy mecz przeżywa jak swój, wtrąca się w skład, ale rozumie szatnię i nie żałuje na pensje.',
    fireAt: 12,
    askTransfer: 0,
    askWages: 10,
    resultWeight: 1.5,
    fansWeight: 0,
  },
  masarnia: {
    label: 'Przedsiębiorca z masarnią',
    desc: 'Kiełbasa jest zawsze, pieniądze czasem. Spokojny, dopóki drużyna nie przynosi wstydu przed klientami. Kiełbasa po meczu na jego koszt.',
    fireAt: 10,
    askTransfer: 5,
    askWages: 0,
    resultWeight: 1,
    fansWeight: 0.15,
  },
}

const TYPES: PresidentType[] = ['biznesmen', 'samorzadowiec', 'pilkarz', 'masarnia']

/** nowy prezes przy przejściu do klubu; im wyżej, tym rzadziej to wójt z gminy */
export function newPresident(rng: Rng, team: Team): President {
  const weights = team.level <= 4 ? [2, 3, 2, 3] : team.level <= 7 ? [3, 2, 3, 2] : [5, 1, 3, 1]
  let r = rng.next() * weights.reduce((a, b) => a + b, 0)
  let type: PresidentType = 'biznesmen'
  for (let i = 0; i < TYPES.length; i++) {
    r -= weights[i]
    if (r <= 0) {
      type = TYPES[i]
      break
    }
  }
  return { teamId: team.id, name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`, type }
}

/** prezes obecnego klubu; stare zapisy dostają go przy pierwszej okazji, bez losowania */
export function presidentOf(s: GameState): President | undefined {
  if (s.clubId === null) return undefined
  if (s.president?.teamId === s.clubId) return s.president
  const team = s.teams[s.clubId]
  const h = (team.id * 2654435761) >>> 0
  return { teamId: team.id, name: `${FIRST_NAMES[h % FIRST_NAMES.length]} ${LAST_NAMES[(h >>> 8) % LAST_NAMES.length]}`, type: TYPES[(h >>> 16) % 4] }
}

/** próg zwolnienia zależy od prezesa */
export function fireThreshold(s: GameState): number {
  const p = presidentOf(s)
  return p ? PRESIDENT_INFO[p.type].fireAt : 12
}

// ---------- rywal i derby ----------

/** czy dwie drużyny to klub i jego rezerwy */
function family(a: Team, b: Team): boolean {
  const base = (t: Team) => t.name.replace(/ II$/, '')
  return base(a) === base(b)
}

/**
 * Rywal w lidze: najpierw klub z tego samego miasta, potem „odwieczny rywal” z tego samego województwa.
 * Wynik zależy tylko od składu ligi, więc przez cały sezon jest ten sam.
 */
export function rivalId(s: GameState): number | undefined {
  if (s.clubId === null) return undefined
  const me = s.teams[s.clubId]
  const lg = s.leagues.find((l) => l.teamIds.includes(me.id))
  if (!lg) return undefined
  const others = lg.teamIds.map((id) => s.teams[id]).filter((t) => t.id !== me.id && !family(t, me))
  const town = others.filter((t) => t.town === me.town).sort((a, b) => b.strength - a.strength)[0]
  if (town) return town.id
  const region = others.filter((t) => t.region && t.region === me.region)
  const pool = region.length ? region : others
  if (!pool.length) return undefined
  // stały „los” z numerów klubów: ten sam rywal po wczytaniu gry i w kolejnych meczach
  return pool.sort((a, b) => ((me.id * 31 + a.id * 17) % 101) - ((me.id * 31 + b.id * 17) % 101))[0].id
}

export function isDerby(s: GameState, opp: number): boolean {
  if (s.clubId === null) return false
  const me = s.teams[s.clubId]
  const o = s.teams[opp]
  if (!o || o.country || family(me, o)) return false
  return o.town === me.town || opp === rivalId(s)
}

/** skutki derbów poza zwykłym wynikiem: kibice, zarząd i nerwy trenera reagują mocniej */
export function derbyAftermath(s: GameState, pts: number): string {
  if (pts === 3) {
    adjustTrust(s, { fans: 6, board: 2, squad: 2 })
    return 'Derby wygrane. Miasto należy do nas co najmniej do rewanżu.'
  }
  if (pts === 1) {
    adjustTrust(s, { fans: -1 })
    return 'Remis w derbach. Obie strony ogłaszają moralne zwycięstwo.'
  }
  adjustTrust(s, { fans: -7, board: -3 })
  return 'Przegrane derby. Przez tydzień lepiej nie pokazywać się w sklepie.'
}

// ---------- przemowa w przerwie ----------

export type Speech = 'asystent' | 'spokojnie' | 'wscieklosc' | 'kielbasa'

export const SPEECHES: { id: Speech; label: string; hint: string }[] = [
  { id: 'asystent', label: 'Asystent decyduje', hint: 'Asystent dobierze przemowę do wyniku.' },
  { id: 'spokojnie', label: '„Spokojnie, panowie”', hint: 'Pomaga dowieźć prowadzenie. Przy wyniku na minusie niewiele daje.' },
  { id: 'wscieklosc', label: 'Wściekłość', hint: 'Przy przegrywaniu drużyna rusza do ataku, ale zostawia dziury. Krzyk bez powodu psuje humor szatni.' },
  { id: 'kielbasa', label: '„Kiełbasa po meczu”', hint: 'Trochę lepsza gra i lepszy humor szatni. Kiełbasa kosztuje, chyba że prezes ma masarnię.' },
]

/** asystent wybiera według wyniku do przerwy */
export function assistantSpeech(diff: number): Exclude<Speech, 'asystent'> {
  return diff < 0 ? 'wscieklosc' : diff > 0 ? 'spokojnie' : 'kielbasa'
}

export interface SpeechEffect {
  att: number
  def: number
  /** szansa na kartkę razy */
  cards: number
  text: string
}

/** skutek przemowy na drugą połowę; diff to wynik do przerwy z naszej perspektywy */
export function speechEffect(speech: Exclude<Speech, 'asystent'>, diff: number): SpeechEffect {
  switch (speech) {
    case 'spokojnie':
      return diff > 0
        ? { att: 0, def: 2.5, cards: 1, text: '„Spokojnie, panowie. Robimy swoje.” Drużyna zamyka tyły.' }
        : { att: 0.5, def: 0.5, cards: 1, text: '„Spokojnie, panowie.” Panowie spokojnie kiwają głowami.' }
    case 'wscieklosc':
      return diff < 0
        ? { att: 3.5, def: -1.5, cards: 1.6, text: 'Trener rzuca butelką wody w tablicę. Drużyna wybiega na drugą połowę jak z procy.' }
        : { att: 1, def: -0.5, cards: 1.4, text: 'Trener krzyczy, chociaż nie przegrywamy. Zawodnicy nie wiedzą, o co chodzi, ale biegają.' }
    case 'kielbasa':
      return { att: 1, def: 1, cards: 1, text: '„Wygramy, to kiełbasa z grilla na koszt klubu!” W szatni pachnie motywacją.' }
  }
}

/** skutki przemowy po meczu: szatnia, a przy kiełbasie także budżet */
export function speechAftermath(s: GameState, speech: Exclude<Speech, 'asystent'>, diffAtHalf: number, pts: number, cost: number): string | undefined {
  if (speech === 'wscieklosc' && diffAtHalf >= 0) {
    adjustTrust(s, { squad: -2 })
    return 'W szatni pytają, po co był ten krzyk w przerwie.'
  }
  if (speech === 'kielbasa' && pts > 0) {
    if (presidentOf(s)?.type === 'masarnia') {
      adjustTrust(s, { squad: 3, board: 1 })
      return 'Kiełbasa z masarni prezesa. Prezes osobiście przewraca na grillu.'
    }
    const paid = Math.min(cost, Math.max(0, s.budget))
    s.budget -= paid
    adjustTrust(s, { squad: 3 })
    return paid ? 'Kiełbasa po meczu. Skarbnik klubu krzywi się na rachunek.' : 'Kiełbasa po meczu na kredyt u pana z budki. Szatnia i tak zadowolona.'
  }
  return undefined
}

// ---------- ulubieniec szatni ----------

export interface Favorite {
  playerId: number
  season: number
  story: number
  /** mecze z rzędu na ławce, gdy był zdrowy */
  benched?: number
  /** szatnia już się upomniała w tej serii */
  warned?: boolean
}

export const FAVORITE_STORIES = [
  'przynosi do szatni ciasto od mamy',
  'zna wszystkie przyśpiewki kibiców, także te nieprzyzwoite',
  'parodiuje prezesa tak, że płaczą nawet masażyści',
  'jako jedyny pamięta urodziny kierownika drużyny',
  'gra na akordeonie w autokarze',
  'naprawia wszystkim telefony i bojler w szatni',
  'robi najlepszą kawę z ekspresu przelewowego w klubie',
  'tłumaczy obcokrajowcom polskie przekleństwa z kontekstem kulturowym',
]

export function favoritePlayer(s: GameState): Player | undefined {
  const f = s.favorite
  if (!f || f.season !== s.season) return undefined
  return s.squad.find((p) => p.id === f.playerId)
}

export function favoriteStory(s: GameState): string | undefined {
  const f = s.favorite
  return f && f.season === s.season ? FAVORITE_STORIES[f.story % FAVORITE_STORIES.length] : undefined
}

/** przed pierwszym meczem sezonu szatnia wybiera ulubieńca; zwykle ktoś z doświadczeniem albo wesoły młody */
export function pickFavorite(rng: Rng, s: GameState): void {
  if (s.favorite?.season === s.season && s.squad.some((p) => p.id === s.favorite!.playerId)) return
  if (s.favorite?.season === s.season) return // odszedł w trakcie sezonu: nowego ulubieńca już nie będzie
  const pool = s.squad.filter((p) => p.pos !== 'BR' && !p.traits.includes('syn_prezesa'))
  if (!pool.length) return
  const p = rng.pick(pool)
  const story = rng.int(0, FAVORITE_STORIES.length - 1)
  s.favorite = { playerId: p.id, season: s.season, story }
  news(s, `${p.firstName} ${p.lastName} to ulubieniec szatni w tym sezonie: ${FAVORITE_STORIES[story]}.`)
}

/** po meczu: ulubieniec na ławce psuje humor szatni, ulubieniec z golem go poprawia */
export function favoriteAfterMatch(s: GameState, played: Set<number>, scorers: Set<number>, available: (p: Player) => boolean): void {
  const f = s.favorite
  if (!f || f.season !== s.season) return
  const p = s.squad.find((x) => x.id === f.playerId)
  if (!p) {
    if (f.benched !== -1) {
      f.benched = -1
      adjustTrust(s, { squad: -6 })
      news(s, 'Szatnia nie może się pogodzić z odejściem swojego ulubieńca. Na treningu cisza jak na pogrzebie.')
    }
    return
  }
  if (played.has(p.id)) {
    f.benched = 0
    f.warned = false
    if (scorers.has(p.id)) {
      adjustTrust(s, { squad: 1, fans: 1 })
      setMorale(p, 3)
    }
    return
  }
  if (!available(p)) return
  f.benched = (f.benched ?? 0) + 1
  if (f.benched >= 3 && !f.warned) {
    f.warned = true
    adjustTrust(s, { squad: -3 })
    news(s, `${p.firstName[0]}. ${p.lastName} siedzi na ławce od ${f.benched} meczów. Kapitan pyta w imieniu szatni, czy trener aby na pewno wie, co robi.`)
  }
}

// ---------- lokalna prasa ----------

type HeadlineKind = 'rout' | 'win' | 'draw0' | 'draw' | 'loss' | 'thrashed' | 'derbyWin' | 'derbyLoss'

// nazwy klubów i miast zawsze w mianowniku (podmiot albo po myślniku), bo odmiany nazw nie zgadniemy
const LOW: Record<HeadlineKind, string[]> = {
  rout: ['{my} rozjeżdża rywali jak kombajn ściernisko. {wynik}!', '{wynik}! Sołtys potwierdza: świętowanie trwało do rana', 'Pogrom: {my} – {opp} {wynik}. Rywale proszą o przełożenie rewanżu na nigdy'],
  win: ['{my} – {opp} {wynik}. {strzelec} bohaterem sobotniego popołudnia', 'Trzy punkty nasze. Bufet notuje rekord sprzedaży', 'Wygrana {wynik}. Kibice: trener wie, co robi'],
  draw0: ['0:0. Najciekawszy był pies, który wbiegł na boisko w 70. minucie', 'Bezbramkowo. Kto wyszedł przed końcem, niczego nie stracił', 'Remis 0:0. Sędzia też się nudził'],
  draw: ['Remis {wynik}. Każdy wraca z punktem i pretensjami', 'Podział punktów. Trener szanuje ten punkt, kibice nie bardzo', '{my} – {opp} {wynik}. Mogło być lepiej, mogło być gorzej'],
  loss: ['Porażka {wynik}. Na forum już szukają winnego', '{opp} lepszy. Anonimowy kibic pyta, czy trener nie wolałby hodować pieczarek', 'Nie tym razem. {my} bez punktów, {opp} zadowolony'],
  thrashed: ['Blamaż! {wynik} i wstyd na całą gminę', 'Po meczu kibice czekali pod szatnią. Nie po autografy', '{wynik}. Bramkarz pyta, czy może wrócić do domu pieszo'],
  derbyWin: ['DERBY NASZE! {my} rządzi w okolicy', 'Derby dla nas! Samochody trąbiły do północy', 'Derby {wynik}. Sąsiedzi do rewanżu siedzą cicho'],
  derbyLoss: ['Przegrane derby. Żałoba do niedzieli', 'Derby dla sąsiadów. Na forum 300 komentarzy, 290 do moderacji', 'Wstyd w derbach. Kibice żądają przeprosin na piśmie'],
}

const HIGH: Record<HeadlineKind, string[]> = {
  rout: ['Koncert! {my} – {opp} {wynik}', '{my} w gazie. {wynik}, a eksperci w studiu przecierają oczy', 'Demolka! {strzelec} i spółka bez litości'],
  win: ['{my} – {opp} {wynik}. {strzelec} znowu ważny', '{my} z kompletem punktów. Trener chwali mentalność', '{my} wygrywa {wynik}. Plan wykonany'],
  draw0: ['Bezbramkowy remis. Statystyki xG też się nudziły', '0:0. Taktyczne szachy bez mata', 'Remis 0:0, w studiu analizują głównie fryzury'],
  draw: ['{my} – {opp} {wynik}. Punkt, który niczego nie załatwia', 'Remis {wynik}. Trener zapowiada wyciągnięcie wniosków', 'Podział punktów: {my} – {opp} {wynik}'],
  loss: ['Porażka {wynik}. Pytania o formę wracają', '{opp} lepszy. Prezes milczy, co mówi więcej niż komentarz', '{my} – {opp} {wynik}. Zero punktów, sporo pytań'],
  thrashed: ['Katastrofa! {wynik} i pytania o przyszłość trenera', 'Kompromitacja. Eksperci w studiu: to nie był zespół', '{wynik}. Kibice gwiżdżą, prezes wychodzi przed końcem'],
  derbyWin: ['{my} rządzi w derbach! Miasto jest nasze', '{my} wygrywa derby {wynik}. Trybuny śpiewają do końca', 'Derbowy triumf. {strzelec} bohaterem'],
  derbyLoss: ['Derby przegrane. Trener pod ostrzałem kibiców', 'Bolesna porażka w derbach. Atmosfera gęstnieje', '{opp} rządzi w derbach. Trener przeprasza kibiców'],
}

/** krótki nagłówek z lokalnej gazety albo portalu po meczu */
export function matchHeadline(
  rng: Rng,
  s: GameState,
  x: { opp: number; my: number; their: number; derby: boolean; scorer?: string; level: number },
): string {
  const d = x.my - x.their
  const kind: HeadlineKind =
    x.derby && d !== 0 ? (d > 0 ? 'derbyWin' : 'derbyLoss') : d >= 3 ? 'rout' : d > 0 ? 'win' : d === 0 ? (x.my === 0 ? 'draw0' : 'draw') : d <= -3 ? 'thrashed' : 'loss'
  const low = x.level <= 5
  const outlet = low && rng.chance(0.4) ? 'Forum kibiców' : x.level >= 9 && rng.chance(0.35) ? 'Studio Ligowe TV' : paperFor(x.level)
  const team = s.teams[s.clubId!]
  const text = rng
    .pick((low ? LOW : HIGH)[kind])
    .replace(/\{my\}/g, team.name)
    .replace(/\{opp\}/g, s.teams[x.opp].name)
    .replace(/\{wynik\}/g, `${x.my}:${x.their}`)
    .replace(/\{strzelec\}/g, x.scorer ?? 'Nikt')
  return `${outlet}: ${text}`
}
