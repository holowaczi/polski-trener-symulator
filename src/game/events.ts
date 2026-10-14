import type { Rng } from './rng'
import type { GameState, Player, TraitId } from './types'
import { addModifier, adjustCoach, adjustTrust, nudgeForm, setMorale } from './util'

export interface EventCtx {
  s: GameState
  rng: Rng
  p?: Player
}

export interface GameEvent {
  id: string
  weight?: number
  minLevel?: number
  maxLevel?: number
  once?: boolean
  /** zdarzenie dotyczy zawodnika: dowolnego, z cechą albo spełniającego warunek */
  player?: 'any' | TraitId | ((p: Player, s: GameState) => boolean)
  condition?: (s: GameState) => boolean
  /** {p} imię i nazwisko, {ps} skrót, {ocena} średnia ocen, {mecze} mecze bez gry, {klub}, {miasto}, {trener} */
  text: string
  options: { label: string; apply: (c: EventCtx) => string }[]
}

// skróty, żeby opcje zdarzeń były czytelne
const trust = (s: GameState, board = 0, squad = 0, fans = 0) => adjustTrust(s, { board, squad, fans })
const coach = (s: GameState, stress = 0, reputation = 0, savings = 0) => adjustCoach(s, { stress, reputation, savings })
const mod = addModifier
const teamMorale = (s: GameState, d: number) => s.squad.forEach((p) => setMorale(p, d))
const scandal = (s: GameState, text: string) => s.scandals.push(text)
const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)} tys. zł` : `${v} zł`)
/** kwota zależna od poziomu ligi */
const money = (s: GameState, base: number) => Math.round(base * Math.pow(2.2, s.teams[s.clubId!].level))
const last3 = (s: GameState) => s.streak.slice(-3).join('')
const median = (s: GameState) => [...s.squad].sort((a, b) => b.skill - a.skill)[Math.min(13, s.squad.length - 1)]?.skill ?? 0
/** umiejętność n-tego najlepszego zawodnika kadry */
const topSkill = (s: GameState, n: number) => [...s.squad].sort((a, b) => b.skill - a.skill)[Math.min(n - 1, s.squad.length - 1)]?.skill ?? 0
/** zawodnik odchodzi z klubu (sprzedaż) */
const removePlayer = (s: GameState, p: Player) => {
  s.squad = s.squad.filter((x) => x.id !== p.id)
  s.lineup.xi = s.lineup.xi.filter((id) => id !== p.id)
  s.lineup.bench = s.lineup.bench.filter((id) => id !== p.id)
}

export const EVENTS: GameEvent[] = [
  // ---------- zdarzenia wynikające z meczów ----------
  {
    id: 'lawka_skarga',
    weight: 2.5,
    player: (p, s) => p.benchStreak >= 3 && p.injuredFor === 0 && p.skill >= median(s) && !p.traits.includes('syn_prezesa'),
    text: '{p} nie zagrał od {mecze} meczów. Puka do gabinetu: „Trenerze, ja tu przyszedłem grać, nie grzać ławę”.',
    options: [
      {
        label: 'Obiecaj mu miejsce w składzie',
        apply: ({ s, p }) => {
          setMorale(p!, 20)
          s.flags[`obietnica:${p!.id}`] = s.round
          return '{ps} wychodzi zadowolony. Zapamięta tę obietnicę, Ty też lepiej zapamiętaj.'
        },
      },
      {
        label: '„Musisz wygrać rywalizację na treningu”',
        apply: ({ s, p }) => {
          setMorale(p!, -8)
          p!.progress += 0.3
          trust(s, 1, 2, 0)
          return '{ps} zaciska zęby i zostaje po treningach. Szatnia widzi, że miejsce trzeba wywalczyć.'
        },
      },
      {
        label: 'Wystaw go na listę transferową',
        apply: ({ s, p }) => {
          setMorale(p!, -25)
          trust(s, 0, -3, 0)
          return '{ps} dowiaduje się o tym z Facebooka. Atmosfera w szatni gęstnieje.'
        },
      },
    ],
  },
  {
    id: 'czerwona_kara',
    weight: 3,
    player: (p) => p.suspendedFor > 0,
    text: '{p} wyleciał z boiska i pauzuje. Zarząd pyta, czy klub wyciągnie konsekwencje.',
    options: [
      {
        label: 'Kara finansowa',
        apply: ({ s, p }) => {
          setMorale(p!, -12)
          trust(s, 3, -2, 0)
          return '{ps} płaci karę. Zarząd zadowolony, w szatni szepczą, że trener nie broni swoich.'
        },
      },
      {
        label: 'Obroń go publicznie',
        apply: ({ s, p }) => {
          setMorale(p!, 12)
          trust(s, -4, 5, 2)
          coach(s, 0, -1)
          return 'Na konferencji mówisz, że sędzia „widział inny mecz”. Szatnia za Tobą murem, związek patrzy krzywo.'
        },
      },
      {
        label: 'Dodatkowe treningi zamiast kary',
        apply: ({ p }) => {
          p!.progress += 0.4
          setMorale(p!, -4)
          return '{ps} odrabia karę na siłowni. Przynajmniej coś z tego będzie.'
        },
      },
    ],
  },
  {
    id: 'kryzys_formy',
    weight: 2.5,
    player: (p) => p.form <= -2 && p.apps >= 3,
    text: '{p} ma kryzys. Średnia ocen {ocena}, ostatnie mecze to katastrofa. Co robisz?',
    options: [
      {
        label: 'Rozmowa w cztery oczy',
        apply: ({ p, rng }) => {
          setMorale(p!, 10)
          if (rng.chance(0.55)) {
            nudgeForm(p!, 2)
            return 'Okazało się, że {ps} miał kłopoty w domu. Po rozmowie widać światełko w tunelu.'
          }
          return '{ps} pokiwał głową, ale nadal myślami jest gdzie indziej.'
        },
      },
      {
        label: 'Psycholog sportowy z budżetu klubu',
        apply: ({ s, p }) => {
          const c = money(s, 300)
          s.budget -= c
          nudgeForm(p!, 2)
          setMorale(p!, 6)
          return `Psycholog (${k(c)}) pracuje z {ps}. Zawodnik mówi, że „odzyskał flow”.`
        },
      },
      {
        label: 'Posadź go na ławce',
        apply: ({ p }) => {
          setMorale(p!, -12)
          return '{ps} siada na ławce. Albo się odbuduje, albo obrazi.'
        },
      },
    ],
  },
  {
    id: 'gwiazda_formy',
    weight: 2,
    player: (p) => p.form >= 2 && p.apps >= 4,
    text: '{p} gra jak natchniony, średnia {ocena}. Media się nim zachwycają, a agent już dzwoni.',
    options: [
      {
        label: 'Daj mu podwyżkę o 20%',
        apply: ({ s, p }) => {
          p!.wage = Math.round((p!.wage * 1.2) / 100) * 100
          setMorale(p!, 15)
          trust(s, 0, -2, 0)
          return '{ps} podpisuje aneks. Reszta szatni liczy, ile sama zarabia.'
        },
      },
      {
        label: 'Pochwal go publicznie',
        apply: ({ s, p, rng }) => {
          setMorale(p!, 10)
          trust(s, 0, 0, 2)
          if (rng.chance(0.35)) {
            nudgeForm(p!, -2)
            return '{ps} przeczytał o sobie wszystkie artykuły. Sodówka uderzyła do głowy.'
          }
          return '{ps} dziękuje drużynie. Wzorowa postawa.'
        },
      },
      {
        label: 'Nic nie mów, niech pracuje',
        apply: ({ p }) => {
          setMorale(p!, -3)
          p!.progress += 0.2
          return '{ps} trenuje dalej. Pracuje, choć liczył na jakieś słowo.'
        },
      },
    ],
  },
  {
    id: 'seria_porazek',
    weight: 4,
    condition: (s) => last3(s) === 'LLL',
    text: 'Trzy porażki z rzędu. Prezes zwołuje zebranie zarządu, a kibice piszą listy otwarte.',
    options: [
      {
        label: 'Zapowiedz zmiany w składzie',
        apply: ({ s }) => {
          trust(s, 6, -3, 2)
          coach(s, 4)
          mod(s, 'Wstrząs po serii porażek', 1.5, 2)
          return 'Zarząd daje Ci jeszcze chwilę. Zawodnicy wiedzą, że nikt nie jest pewny miejsca.'
        },
      },
      {
        label: 'Dwudniowy wyjazd integracyjny',
        apply: ({ s }) => {
          const c = money(s, 600)
          s.budget -= c
          trust(s, -2, 8, 0)
          coach(s, -10)
          mod(s, 'Odbudowana atmosfera', 1, 3)
          return `Hotel nad jeziorem, kajaki i rozmowy do rana (${k(c)}). Drużyna znów jest drużyną.`
        },
      },
      {
        label: 'Zrzuć winę na sędziów',
        apply: ({ s }) => {
          trust(s, -3, 2, 4)
          coach(s, -3, -1)
          scandal(s, 'Wojna z sędziami po serii porażek')
          return 'Kibice kupili tę wersję. Kolegium sędziów zapamiętało nazwisko trenera.'
        },
      },
    ],
  },
  {
    id: 'seria_zwyciestw',
    weight: 3,
    condition: (s) => last3(s) === 'WWW',
    text: 'Trzy wygrane z rzędu! W mieście mówi się już o „projekcie {trener}”. Jak to wykorzystać?',
    options: [
      {
        label: 'Premia dla drużyny',
        apply: ({ s }) => {
          const c = money(s, 500)
          s.budget -= c
          trust(s, 0, 6, 0)
          teamMorale(s, 8)
          return `Premia wypłacona (${k(c)}). Zawodnicy chcą więcej, w dobrym tego słowa znaczeniu.`
        },
      },
      {
        label: 'Trzymaj ich w ryzach',
        apply: ({ s }) => {
          mod(s, 'Koncentracja', 1, 2)
          trust(s, 2, -1, 0)
          return 'Zero świętowania, pełna koncentracja. Ktoś mówi pod nosem „sztywniak”, ale grają dalej.'
        },
      },
      {
        label: 'Niech świętują',
        apply: ({ s }) => {
          trust(s, 0, 6, 3)
          mod(s, 'Sodówka', -2, 2)
          coach(s, -8)
          return 'Impreza w klubie do białego rana. Wszyscy szczęśliwi, nikt nie pamięta treningu.'
        },
      },
    ],
  },
  {
    id: 'stres_trenera',
    weight: 4,
    condition: (s) => s.coach.stress >= 70,
    text: 'Lekarz rodzinny mierzy Ci ciśnienie: 180 na 110. „Panie trenerze, tak dalej nie można”.',
    options: [
      {
        label: 'Weź tydzień urlopu',
        apply: ({ s }) => {
          coach(s, -35)
          trust(s, -5, 0, 0)
          mod(s, 'Asystent prowadzi treningi', -1, 2)
          return 'Tydzień na Mazurach. Asystent prowadzi treningi, zawodnicy trochę się rozluźniają.'
        },
      },
      {
        label: 'Joga i melisa',
        apply: ({ s }) => {
          coach(s, -15, 0, -500)
          return 'Poranna joga w szatni. Bramkarz też się przyłączył i podobno lepiej skacze.'
        },
      },
      {
        label: 'Zignoruj, sezon trwa',
        apply: ({ s, rng }) => {
          coach(s, 5)
          if (rng.chance(0.35)) {
            mod(s, 'Trener w szpitalu', -2, 3)
            coach(s, -20, -2)
            return 'Lądujesz w szpitalu na obserwacji. Drużyna gra trzy mecze bez Ciebie na ławce.'
          }
          return 'Jakoś dajesz radę. Kawa numer siedem tego dnia.'
        },
      },
    ],
  },
  {
    id: 'powrot_kontuzja',
    weight: 2,
    player: (p) => p.injuredFor >= 1 && p.injuredFor <= 3 && p.skill >= 0,
    text: '{p} twierdzi, że już jest zdrowy i chce grać w najbliższym meczu. Fizjoterapeuta ma wątpliwości.',
    options: [
      {
        label: 'Niech gra',
        apply: ({ p, rng }) => {
          const rest = p!.injuredFor
          p!.injuredFor = 0
          if (rng.chance(0.4)) {
            p!.injuredFor = rest + 3
            return `{ps} na pierwszym treningu odnowił uraz. Teraz pauza: ${p!.injuredFor} meczów.`
          }
          setMorale(p!, 10)
          return '{ps} wraca wcześniej. Na razie wszystko trzyma.'
        },
      },
      {
        label: 'Słuchamy fizjoterapeuty',
        apply: ({ p }) => {
          setMorale(p!, -4)
          return '{ps} wraca zgodnie z planem. Marudzi, ale zdrowie najważniejsze.'
        },
      },
    ],
  },
  {
    id: 'mlody_szansa',
    weight: 1.5,
    player: (p) => p.age <= 20 && p.benchStreak >= 3,
    text: 'Ojciec 18-letniego {p} czeka pod szatnią. „Chłopak trenuje jak szalony, a pan go nie widzi”.',
    options: [
      {
        label: 'Obiecaj mu minuty',
        apply: ({ s, p }) => {
          setMorale(p!, 15)
          p!.progress += 0.3
          s.flags[`obietnica:${p!.id}`] = s.round
          return 'Ojciec wychodzi zadowolony. Chłopak też. Teraz trzeba to spełnić.'
        },
      },
      {
        label: 'Wypożycz go do niższej ligi',
        apply: ({ p }) => {
          p!.injuredFor = 0
          p!.progress += 0.8
          setMorale(p!, -5)
          return '{ps} będzie trenował z niższym klubem przez kilka tygodni. Wróci silniejszy.'
        },
      },
      {
        label: 'Trener tu decyduje',
        apply: ({ s, p }) => {
          setMorale(p!, -12)
          trust(s, 1, -1, -1)
          return 'Ojciec wypisał komentarz na Facebooku klubu. Długi.'
        },
      },
    ],
  },

  // ---------- życie klubu ----------
  {
    id: 'wesele',
    maxLevel: 5,
    player: 'any',
    text: '{p} przyszedł na trening prosto z wesela kuzyna. Jest w garniturze i mówi, że „da radę”.',
    options: [
      {
        label: 'Odeślij go do domu i ukarz',
        apply: ({ s, p }) => {
          setMorale(p!, -15)
          nudgeForm(p!, -1)
          trust(s, 2, -2, 0)
          return '{ps} obrażony, ale szatnia zrozumiała przekaz.'
        },
      },
      {
        label: 'Niech trenuje, przynajmniej przyszedł',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.5)) {
            p!.injuredFor = 2
            return '{ps} naciągnął mięsień przy rozgrzewce w lakierkach. Dwa mecze przerwy.'
          }
          trust(s, 0, 3, 0)
          nudgeForm(p!, 1)
          return '{ps} strzelił na treningu trzy gole. Szatnia uważa, że wesela powinny być obowiązkowe.'
        },
      },
      {
        label: 'Cała drużyna idzie na poprawiny',
        apply: ({ s, rng }) => {
          teamMorale(s, 10)
          mod(s, 'Kac po poprawinach', -2, 1)
          coach(s, -8)
          if (rng.chance(0.3)) {
            scandal(s, 'Cała drużyna na poprawinach w środku sezonu')
            trust(s, -10, 8, 4)
            return 'Zdjęcia z poprawin trafiły do lokalnej gazety. Prezes nie jest zachwycony.'
          }
          trust(s, 0, 8, 2)
          return 'Integracja na najwyższym poziomie, kondycja na najniższym. Najbliższy mecz będzie ciężki.'
        },
      },
    ],
  },
  {
    id: 'wojt_syn',
    maxLevel: 5,
    text: 'Wójt gminy przyszedł na trening. Jego syn „ma papiery na granie” i powinien zagrać w pierwszym składzie.',
    options: [
      {
        label: 'Daj synowi szansę',
        apply: ({ s, rng }) => {
          s.budget += money(s, 3000)
          teamMorale(s, -5)
          mod(s, 'Syn wójta w składzie', -1, 1)
          return rng.chance(0.2)
            ? 'Syn wójta strzelił samobója i uciekł z boiska. Ale gmina dorzuciła na nowe bramki.'
            : 'Syn wójta zagrał 30 minut, dotknął piłki dwa razy. Gmina dorzuca do budżetu.'
        },
      },
      {
        label: 'Grzecznie odmów',
        apply: ({ s }) => {
          trust(s, -6, 4, 0)
          coach(s, 3)
          return 'Wójt wyszedł bez słowa. Następnego dnia na boisku wyłączono wodę.'
        },
      },
    ],
  },
  {
    id: 'masarnia',
    maxLevel: 5,
    text: 'Sponsor główny, lokalna masarnia, grozi wycofaniem się. Chce, żeby zawodnicy grali w koszulkach z wielką kiełbasą.',
    options: [
      {
        label: 'Zgódź się na kiełbasę',
        apply: ({ s }) => {
          s.budget += money(s, 2500)
          s.wageLimit = Math.round(s.wageLimit * 1.05)
          trust(s, 5, -3, -2)
          return 'Nowe koszulki zrobiły furorę w internecie. Klub ma więcej pieniędzy na pensje, zawodnicy mniej godności.'
        },
      },
      {
        label: 'Negocjuj mniejszą kiełbasę',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            s.budget += money(s, 1500)
            return 'Kompromis: kiełbaska na rękawie. Masarnia zostaje.'
          }
          trust(s, -5, 0, 0)
          s.wageLimit = Math.round(s.wageLimit * 0.95)
          return 'Masarnia obraziła się i przeszła do rywala zza miedzy. Limit pensji spada.'
        },
      },
      {
        label: 'Klub ma honor, odmów',
        apply: ({ s }) => {
          trust(s, -8, 2, 5)
          s.wageLimit = Math.round(s.wageLimit * 0.93)
          return 'Kibice dumni. Księgowa płacze i tnie limit pensji.'
        },
      },
    ],
  },
  {
    id: 'kontuzja_grill',
    maxLevel: 5,
    player: 'any',
    text: '{p} poparzył się przy grillu na działce. Twierdzi, że „to nic”, ale ręka wygląda jak kaszanka.',
    options: [
      {
        label: 'Wyślij go do lekarza',
        apply: ({ p }) => {
          p!.injuredFor = 1
          return '{ps} pauzuje jeden mecz. Lekarz zabronił też grillowania, co boli bardziej.'
        },
      },
      {
        label: 'To nic, ręce w piłce niepotrzebne',
        apply: ({ p, rng }) => {
          if (p!.pos === 'BR') {
            p!.injuredFor = 3
            return 'Okazało się, że {ps} to bramkarz. Ręce jednak potrzebne. Trzy mecze przerwy.'
          }
          if (rng.chance(0.4)) nudgeForm(p!, -2)
          return '{ps} gra dalej z bandażem. Wygląda groźnie, ale coś mu nie idzie.'
        },
      },
    ],
  },
  {
    id: 'imprezowicz_dyskoteka',
    maxLevel: 5,
    player: 'imprezowicz',
    text: '{p} był widziany w sobotę o 4 rano w remizie „Kosmos”. Zdjęcia krążą po grupie na Facebooku.',
    options: [
      {
        label: 'Kara finansowa i ławka',
        apply: ({ s, p }) => {
          setMorale(p!, -20)
          trust(s, 3, -1, 0)
          return '{ps} odsiaduje karę na ławce. Remiza straciła stałego klienta.'
        },
      },
      {
        label: 'Udawaj, że nie widziałeś',
        apply: ({ s, p, rng }) => {
          nudgeForm(p!, -1)
          if (rng.chance(0.4)) {
            scandal(s, 'Imprezowa afera w remizie „Kosmos”')
            trust(s, -8, 0, -4)
            coach(s, 6)
            return 'Lokalne media podchwyciły temat. Prezes pyta, czy trener w ogóle czyta Facebooka.'
          }
          trust(s, 0, 2, 0)
          return 'Sprawa ucichła. {ps} w podzięce biega za dwóch, choć trochę wolniej.'
        },
      },
      {
        label: 'Zrób z niego ambasadora trzeźwości',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.5)) {
            p!.traits = p!.traits.filter((t) => t !== 'imprezowicz')
            p!.traits.push('pracus')
            coach(s, 0, 2)
            nudgeForm(p!, 2)
            return '{ps} przeszedł przemianę. Biega maratony i pije kefir.'
          }
          trust(s, -4, -2, 3)
          return '{ps} pojawił się na akcji ambasadorskiej po imprezie. Kibice ubawieni, prezes nie.'
        },
      },
    ],
  },
  {
    id: 'murawa_dziki',
    maxLevel: 5,
    text: 'Dziki zryły pół boiska. Mecz za cztery dni.',
    options: [
      {
        label: 'Zorganizuj czyn społeczny',
        apply: ({ s }) => {
          trust(s, 2, 3, 6)
          mod(s, 'Zmęczenie po łopatach', -1, 1)
          return 'Zawodnicy i kibice wyrównali boisko łopatami. Duch drużyny rośnie, kręgosłupy nie.'
        },
      },
      {
        label: 'Wynajmij firmę',
        apply: ({ s }) => {
          const c = money(s, 1500)
          s.budget -= c
          return `Firma przyjechała z walcem. Koszt: ${k(c)}.`
        },
      },
      {
        label: 'Graj jak jest, to nasz atut',
        apply: ({ s }) => {
          s.tactic.style = 'laga'
          mod(s, 'Własne kartoflisko', 1.5, 2)
          return 'Na takim boisku zostaje tylko laga. Rywale gubią się na wybojach.'
        },
      },
    ],
  },
  {
    id: 'lider_kapitan',
    player: 'lider',
    text: '{p} przychodzi do Ciebie: „Trenerze, szatnia ma pytania o taktykę”.',
    options: [
      {
        label: 'Wysłuchaj zawodników',
        apply: ({ s }) => {
          trust(s, 0, 8, 0)
          s.tactic.mentality = 'atak'
          return 'Długa rozmowa. Ustalono, że wszyscy chcą grać w ataku, więc nastawienie zmienione na atak.'
        },
      },
      {
        label: 'Tu decyduję ja',
        apply: ({ s, p }) => {
          trust(s, 2, -8, 0)
          setMorale(p!, -10)
          coach(s, 3)
          return '{ps} wyszedł, trzaskając drzwiami. W szatni szepty.'
        },
      },
    ],
  },
  {
    id: 'agent',
    minLevel: 4,
    player: (p) => p.skill > 40 && p.apps >= 2,
    text: 'Agent {p} dzwoni: jego klient „ma oferty z Cypru” i chce podwyżki.',
    options: [
      {
        label: 'Daj podwyżkę 25%',
        apply: ({ s, p }) => {
          p!.wage = Math.round((p!.wage * 1.25) / 100) * 100
          setMorale(p!, 20)
          trust(s, 0, -1, 0)
          return '{ps} dostaje podwyżkę. Reszta szatni liczy.'
        },
      },
      {
        label: 'Sprawdź blef',
        apply: ({ p, rng }) => {
          if (rng.chance(0.65)) {
            setMorale(p!, -5)
            return 'Oferta z Cypru okazała się ofertą wakacji all inclusive. {ps} zostaje.'
          }
          setMorale(p!, -25)
          nudgeForm(p!, -1)
          return '{ps} jest śmiertelnie obrażony. Gra, ale bez serca.'
        },
      },
    ],
  },
  {
    id: 'dziennikarz',
    minLevel: 5,
    text: 'Dziennikarz pyta na konferencji, czy nie boisz się zwolnienia.',
    options: [
      {
        label: '„Boję się tylko Boga i mojej żony”',
        apply: ({ s }) => {
          trust(s, 0, 2, 6)
          coach(s, -3, 1)
          return 'Cytat dnia. Kibice drukują koszulki.'
        },
      },
      {
        label: 'Wyjdź z konferencji',
        apply: ({ s }) => {
          trust(s, -4, 0, -3)
          coach(s, 4, -1)
          scandal(s, 'Wyjście z konferencji prasowej w trakcie pytania')
          return 'Nagranie ma 200 tysięcy wyświetleń. Nazwisko trenera w trendach.'
        },
      },
      {
        label: 'Odpowiedz merytorycznie przez 20 minut',
        apply: ({ s }) => {
          trust(s, 2, 0, -1)
          return 'Wszyscy zasnęli. Temat zwolnienia umarł śmiercią naturalną.'
        },
      },
    ],
  },
  {
    id: 'oboz',
    maxLevel: 5,
    text: 'Prezes proponuje krótki obóz przygotowawczy. Do wyboru: Zakopane albo „ośrodek u szwagra pod Grójcem”.',
    options: [
      {
        label: 'Zakopane',
        apply: ({ s }) => {
          const c = money(s, 1200)
          s.budget -= c
          mod(s, 'Forma z Zakopanego', 1.5, 3)
          coach(s, -5)
          return `Obóz udany (${k(c)}). Zawodnicy wrócili z oscypkami i formą.`
        },
      },
      {
        label: 'U szwagra',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            teamMorale(s, 6)
            mod(s, 'Obóz w sadzie', 0.5, 2)
            return 'Ośrodek okazał się sadem jabłkowym. Treningi w rytmie zbiorów. Wszyscy zadowoleni.'
          }
          mod(s, 'Obóz w stawie z rakami', -1, 2)
          teamMorale(s, -4)
          return 'Szwagier zapomniał, że obiecał też basen. Basenem był staw z rakami.'
        },
      },
    ],
  },
  {
    id: 'bramkarz_kebab',
    maxLevel: 5,
    player: (p) => p.pos === 'BR',
    text: '{p} zamówił kebab na ławkę rezerwowych w trakcie meczu. Kamera to nagrała.',
    options: [
      {
        label: 'Ukarz go publicznie',
        apply: ({ s, p }) => {
          trust(s, 3, -3, 0)
          setMorale(p!, -10)
          return 'Kara przyjęta. Kebab skonfiskowany przez kierownika drużyny, który go zjadł.'
        },
      },
      {
        label: 'Podpisz umowę sponsorską z kebabem',
        apply: ({ s, p }) => {
          s.budget += money(s, 1000)
          trust(s, 0, 4, 4)
          setMorale(p!, 10)
          return 'Kebab „U Ahmeda” nowym sponsorem. Darmowe porcje po zwycięstwach.'
        },
      },
    ],
  },
  {
    id: 'derby',
    text: 'Przed derbami kibice proszą o „mocną deklarację”.',
    options: [
      {
        label: '„Wygramy i pojedziemy im po bandzie”',
        apply: ({ s }) => {
          trust(s, 0, 4, 8)
          mod(s, 'Derbowa gorączka', 1.5, 1)
          coach(s, 4)
          return 'Szatnia nakręcona. Rywale wywiesili wycinek z gazety w swojej szatni.'
        },
      },
      {
        label: '„Szanujemy rywala”',
        apply: ({ s }) => {
          trust(s, 3, 0, -5)
          return 'Kibice wywiesili transparent: „Szacunek to se możesz”.'
        },
      },
    ],
  },
  {
    id: 'talent_okazja',
    player: 'talent',
    text: '{p} ma propozycję testów w klubie z Bundesligi. Puszczasz go na tydzień?',
    options: [
      {
        label: 'Puść go, niech się rozwija',
        apply: ({ s, p, rng }) => {
          p!.injuredFor = Math.max(p!.injuredFor, 1)
          if (rng.chance(0.3)) {
            const fee = Math.round(p!.value * 2.5)
            s.budget += fee
            s.squad = s.squad.filter((x) => x.id !== p!.id)
            s.lineup.xi = s.lineup.xi.filter((id) => id !== p!.id)
            s.lineup.bench = s.lineup.bench.filter((id) => id !== p!.id)
            coach(s, 0, 5)
            return `{ps} przeszedł testy! Klub zarabia ${k(fee)}, Ty reputację wychowawcy.`
          }
          p!.progress += 1.5
          setMorale(p!, 10)
          return '{ps} wrócił z testów bez kontraktu, ale z nowymi butami i pewnością siebie.'
        },
      },
      {
        label: 'Nie, potrzebujemy go tutaj',
        apply: ({ p }) => {
          setMorale(p!, -20)
          nudgeForm(p!, -1)
          return '{ps} gra dalej u nas, ale co chwila patrzy w telefon.'
        },
      },
    ],
  },
  {
    id: 'syn_prezesa_lawka',
    player: (p) => p.traits.includes('syn_prezesa') && p.benchStreak >= 2,
    text: 'Prezes dzwoni: „Panie trenerze, a mój syn {ps} to dlaczego od {mecze} meczów nie gra?”.',
    options: [
      {
        label: 'Obiecaj, że zagra',
        apply: ({ s, p }) => {
          trust(s, 8, -5, 0)
          setMorale(p!, 20)
          s.flags[`obietnica:${p!.id}`] = s.round
          return 'Prezes zadowolony. Ci, którzy wylądują przez to na ławce, mniej.'
        },
      },
      {
        label: 'Powiedz prawdę: jest za słaby',
        apply: ({ s, rng }) => {
          if (rng.chance(0.3)) {
            trust(s, 4, 6, 2)
            coach(s, -2, 2)
            return 'Prezes przyznał Ci rację. Podobno sam tak myślał od lat.'
          }
          trust(s, -15, 6, 0)
          coach(s, 8)
          return 'Prezes rzucił słuchawką. Szatnia za to bije brawo.'
        },
      },
    ],
  },
  {
    id: 'pranie',
    maxLevel: 4,
    text: 'Pani Halinka, która od 30 lat pierze stroje, odchodzi na emeryturę. Nikt nie wie, jak działa pralka.',
    options: [
      {
        label: 'Zatrudnij następcę',
        apply: ({ s }) => {
          const c = money(s, 500)
          s.budget -= c
          return `Nowa pani od prania kosztuje ${k(c)}. Stroje znowu pachną.`
        },
      },
      {
        label: 'Każdy pierze sam',
        apply: ({ s, rng }) => {
          teamMorale(s, -4)
          mod(s, 'Różowe koszulki', -0.5, 2)
          if (rng.chance(0.4)) return 'Połowa drużyny wyszła na mecz w różowych koszulkach. Kibice zachwyceni.'
          return 'Stroje są… różne. Sędzia prawie odwołał mecz z powodu braku jednolitych barw.'
        },
      },
      {
        label: 'Przekonaj panią Halinkę, żeby została',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            trust(s, 2, 5, 3)
            return 'Pani Halinka zostaje. Warunek: trener nosi jej sweter na meczach.'
          }
          teamMorale(s, -3)
          s.budget -= money(s, 300)
          return 'Pani Halinka odmówiła. „Panie, ja już mam wnuki do prania”. Pralnia w mieście liczy sobie sporo.'
        },
      },
    ],
  },
  {
    id: 'wyjazd_bus',
    maxLevel: 5,
    text: 'Klubowy bus zepsuł się w drodze na mecz wyjazdowy. Do rozpoczęcia 90 minut.',
    options: [
      {
        label: 'Zamów taksówki',
        apply: ({ s }) => {
          const c = money(s, 400)
          s.budget -= c
          return `Drużyna dojechała pięcioma taksówkami. Rachunek: ${k(c)}.`
        },
      },
      {
        label: 'Łap stopa',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            trust(s, 0, 6, 5)
            mod(s, 'Legenda autostopu', 1, 1)
            return 'Wszyscy dotarli! Bramkarz przyjechał ciągnikiem. Drużyna nakręcona jak nigdy.'
          }
          trust(s, -3, 2, 2)
          mod(s, 'Spóźnieni na rozgrzewkę', -2, 1)
          coach(s, 5)
          return 'Dotarło 9 zawodników. Reszta dobiegnie w trakcie meczu.'
        },
      },
    ],
  },
  {
    id: 'youtuber',
    minLevel: 3,
    maxLevel: 6,
    text: 'Znany youtuber chce nagrać odcinek „Gram w klubie z niższej ligi przez tydzień”.',
    options: [
      {
        label: 'Wpuść go do drużyny',
        apply: ({ s, rng }) => {
          s.budget += money(s, 1200)
          trust(s, 2, -3, 6)
          if (rng.chance(0.3)) {
            scandal(s, 'Youtuber w składzie meczowym')
            mod(s, 'Cyrk z youtuberem', -1, 1)
            return 'Youtuber wszedł z ławki i dostał czerwoną kartkę po 40 sekundach. Film ma 2 mln wyświetleń.'
          }
          coach(s, 0, 1)
          return 'Odcinek ma milion wyświetleń. Klub ma nowych kibiców w całej Polsce.'
        },
      },
      {
        label: 'Odmów, to poważny klub',
        apply: ({ s }) => {
          trust(s, 1, 2, -2)
          return 'Youtuber poszedł do rywala. Teraz wszyscy znają ich, a nie was.'
        },
      },
    ],
  },
  {
    id: 'trening_dodatkowy',
    condition: (s) => s.streak.slice(-3).filter((x) => x === 'L').length >= 2,
    text: 'Słabsze wyniki. Asystent proponuje dodatkowy trening w niedzielę rano.',
    options: [
      {
        label: 'Tak, ciężka praca to podstawa',
        apply: ({ s }) => {
          mod(s, 'Dodatkowe treningi', 1.5, 2)
          trust(s, 3, -5, 0)
          s.squad.forEach((p) => (p.progress += 0.15))
          return 'Niedzielny trening się odbył. Kilku zawodników odwołało rodzinne obiady i dało to odczuć.'
        },
      },
      {
        label: 'Nie, potrzebują odpoczynku',
        apply: ({ s }) => {
          teamMorale(s, 5)
          trust(s, -2, 4, 0)
          coach(s, -4)
          return 'Zawodnicy wypoczęci. Prezes pyta, za co Ci płaci.'
        },
      },
      {
        label: 'Wspólna kolacja dla drużyny',
        apply: ({ s }) => {
          teamMorale(s, 8)
          trust(s, 0, 6, 1)
          coach(s, -6)
          return 'Kolacja na koszt sponsora, telefony w koszyku przy wejściu. Jedność odbudowana.'
        },
      },
    ],
  },
  {
    id: 'sedzia_koperta',
    minLevel: 3,
    maxLevel: 6,
    once: true,
    text: 'Tajemniczy mężczyzna w skórzanej kurtce sugeruje, że „sędzia na sobotę jest do dogadania”.',
    options: [
      {
        label: 'Wyrzuć go za drzwi',
        apply: ({ s }) => {
          coach(s, 0, 3)
          return 'Facet wyszedł. Na odchodne rzucił: „Pan jeszcze pożałuje”. Nie pożałowałeś.'
        },
      },
      {
        label: 'Zgłoś sprawę do związku',
        apply: ({ s, rng }) => {
          coach(s, 4, 5)
          if (rng.chance(0.5)) {
            trust(s, 4, 2, 6)
            return 'Prokuratura zatrzymała pół okręgu. Jesteś lokalnym bohaterem.'
          }
          trust(s, -3, 0, 2)
          return 'Związek obiecał „zająć się sprawą”. Minęło pół roku. Cisza.'
        },
      },
    ],
  },
  {
    id: 'kibice_trening',
    minLevel: 5,
    condition: (s) => s.trust.fans < 40,
    text: 'Grupa kibiców przyszła na trening „porozmawiać” z drużyną.',
    options: [
      {
        label: 'Wyjdź do nich sam',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            trust(s, 0, 4, 10)
            coach(s, -3, 1)
            return 'Rozmowa była twarda, ale uczciwa. Kibice dali drużynie kredyt zaufania.'
          }
          trust(s, -3, 0, -5)
          coach(s, 8)
          return 'Rozmowa skończyła się na tym, że zabrali Ci szalik. Na pamiątkę.'
        },
      },
      {
        label: 'Zamknij trening',
        apply: ({ s }) => {
          trust(s, 0, 3, -8)
          return 'Trening za zamkniętymi drzwiami. Kibice obrażeni na dobre.'
        },
      },
    ],
  },
  {
    id: 'krol_strzalow_ego',
    player: 'krol_strzalow',
    text: '{p} chce wykonywać wszystkie stałe fragmenty. Rzuty rożne też.',
    options: [
      {
        label: 'Dobra, niech strzela',
        apply: ({ s, p }) => {
          setMorale(p!, 15)
          nudgeForm(p!, 1)
          trust(s, 0, -2, 0)
          return '{ps} uszczęśliwiony. Reszta drużyny mniej.'
        },
      },
      {
        label: 'Nie, są zasady',
        apply: ({ s, p }) => {
          setMorale(p!, -12)
          trust(s, 0, 2, 0)
          return '{ps} obrażony. Reszta drużyny odetchnęła.'
        },
      },
    ],
  },
  {
    id: 'ksiegowa',
    minLevel: 4,
    maxLevel: 7,
    text: 'Księgowa klubu informuje, że „pieniądze na pensje gdzieś są, tylko nie wiadomo gdzie”.',
    options: [
      {
        label: 'Przekaż część budżetu transferowego na pensje',
        apply: ({ s }) => {
          const c = Math.round(Math.max(0, s.budget) * 0.3)
          s.budget -= c
          trust(s, 2, 5, 0)
          return `Pensje wypłacone (${k(c)} z budżetu transferowego). Zawodnicy wierzą w projekt.`
        },
      },
      {
        label: 'Niech poczekają',
        apply: ({ s }) => {
          teamMorale(s, -10)
          trust(s, 0, -8, 0)
          mod(s, 'Zaległości w pensjach', -1.5, 3)
          return 'Zawodnicy grają na kredyt. Dwóch założyło grupę „Zaległości FC”.'
        },
      },
    ],
  },
  {
    id: 'ekspert_tv',
    minLevel: 7,
    text: 'Telewizja zaprasza Cię do studia jako eksperta na mecz reprezentacji.',
    options: [
      {
        label: 'Jedź i zabłyśnij',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            coach(s, 0, 4, 5000)
            return 'Twoja analiza „wysokiego bloku” zrobiła wrażenie. Reputacja rośnie.'
          }
          coach(s, 5, -2)
          scandal(s, 'Wpadka w studiu telewizyjnym')
          return 'Pomyliłeś nazwisko selekcjonera na wizji. Mem żyje swoim życiem.'
        },
      },
      {
        label: 'Odmów, skup się na klubie',
        apply: ({ s }) => {
          trust(s, 3, 2, 0)
          return 'Prezes docenia oddanie. Telewizja zaprosiła kogoś innego, kto pomylił nazwisko.'
        },
      },
    ],
  },
  {
    id: 'zagraniczny_testowicz',
    minLevel: 4,
    maxLevel: 6,
    text: 'Na trening przyszedł zawodnik z Brazylii. Twierdzi, że grał w młodzieżówce Santosu. Nikt tego nie może sprawdzić.',
    condition: (s) => s.squad.length < 27,
    options: [
      {
        label: 'Bierz go!',
        apply: ({ s, rng }) => {
          const level = s.teams[s.clubId!].level
          const good = rng.chance(0.35)
          const skill = Math.round(15 + level * 6.5 + (good ? rng.int(6, 12) : rng.int(-12, -4)))
          s.squad.push({
            id: s.nextId++,
            firstName: rng.pick(['Wellington', 'Ronaldinho', 'Jefferson', 'Kleberson', 'Washington']),
            lastName: rng.pick(['da Silva', 'Souza', 'Oliveira', 'Santos']),
            age: rng.int(21, 29),
            pos: rng.pick(['POM', 'NAP'] as const),
            skill,
            potential: skill + 2,
            form: 0,
            morale: 80,
            traits: good ? [] : ['leniwy'],
            injuredFor: 0,
            suspendedFor: 0,
            yellows: 0,
            goals: 0,
            assists: 0,
            apps: 0,
            ratings: [],
            ratingSum: 0,
            progress: 0,
            benchStreak: 0,
            value: 1000,
            wage: Math.round(300 * Math.pow(1.1, skill - 20) / 100) * 100,
          })
          trust(s, 0, 0, 5)
          return good
            ? 'Brazylijczyk naprawdę umie grać! Kibice śpiewają po portugalsku. Źle, ale z sercem.'
            : 'Brazylijczyk grał w młodzieżówce Santosu, ale chyba w siatkówkę. Pensję i tak chce.'
        },
      },
      {
        label: 'Podziękuj',
        apply: ({ s }) => {
          trust(s, 0, 0, -3)
          return 'Brazylijczyk poszedł do rywala zza miedzy. Kibice pytają, czemu u nas zawsze „nie ma budżetu”.'
        },
      },
    ],
  },
  {
    id: 'dotacja_gmina',
    maxLevel: 5,
    text: 'Gmina ogłasza konkurs na dotacje dla sportu. Trzeba wypełnić 40 stron wniosku.',
    options: [
      {
        label: 'Siedź po nocach i wypełnij',
        apply: ({ s, rng }) => {
          coach(s, 10)
          if (rng.chance(0.6)) {
            const c = money(s, 3000)
            s.budget += c
            return `Dotacja przyznana: ${k(c)}! Trener nie spał tydzień.`
          }
          return 'Wniosek odrzucony. Brakowało pieczątki na stronie 37.'
        },
      },
      {
        label: 'Nie ma czasu, jest liga',
        apply: ({ s }) => {
          trust(s, -4, 0, 0)
          coach(s, -4)
          return 'Dotację dostało koło gospodyń wiejskich. Prezes liczył na te pieniądze, ale trener przynajmniej się wyspał.'
        },
      },
    ],
  },
  {
    id: 'szklany_powrot',
    player: (p) => p.traits.includes('szklany') && p.injuredFor === 0,
    text: '{p} twierdzi, że „coś go ciągnie w łydce”. Mecz jest ważny.',
    options: [
      {
        label: 'Niech odpocznie',
        apply: ({ p }) => {
          p!.injuredFor = 1
          return '{ps} odpoczywa jeden mecz. Ciągnie go teraz w drugiej łydce.'
        },
      },
      {
        label: 'Graj, to tylko łydka',
        apply: ({ p, rng }) => {
          if (rng.chance(0.55)) {
            p!.injuredFor = rng.int(3, 8)
            return `{ps} zerwał mięsień. Przerwa: ${p!.injuredFor} meczów. Lekarz klubowy kręci głową.`
          }
          return '{ps} zagrał i nic mu nie jest. Tym razem.'
        },
      },
    ],
  },
  {
    id: 'prezes_motywacja',
    maxLevel: 5,
    condition: (s) => s.trust.board < 40,
    text: 'Prezes zaprasza na „poważną rozmowę” do swojej hurtowni.',
    options: [
      {
        label: 'Obiecaj wygraną w najbliższym meczu',
        apply: ({ s }) => {
          trust(s, 8, 0, 0)
          coach(s, 8)
          s.flags.obietnicaWygranej = s.round
          return 'Prezes kupił obietnicę. Na razie. Teraz trzeba wygrać.'
        },
      },
      {
        label: 'Pokaż mu dane i analizy',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            trust(s, 10, 0, 0)
            return 'Prezes nie zrozumiał wykresów, ale były kolorowe. Zaufanie rośnie.'
          }
          trust(s, -4, 0, 0)
          coach(s, 4)
          return '„Ja tu widzę tylko, że przegrywamy” – podsumował prezes.'
        },
      },
      {
        label: 'Zaproponuj prezesowi miejsce na ławce',
        apply: ({ s }) => {
          trust(s, 12, -6, -2)
          mod(s, 'Prezes na ławce', -1, 3)
          scandal(s, 'Prezes na ławce trenerskiej')
          return 'Prezes siedzi na ławce w dresie. Zmiany robi sam. Klimat w szatni gęstnieje.'
        },
      },
    ],
  },
  {
    id: 'mlody_talent_wies',
    maxLevel: 5,
    condition: (s) => s.squad.length < 27,
    text: 'Dziadek przyprowadził na trening wnuka. „Strzela z lewej jak Lewandowski z prawej”.',
    options: [
      {
        label: 'Daj mu szansę',
        apply: ({ s, rng }) => {
          const level = s.teams[s.clubId!].level
          const great = rng.chance(0.3)
          const skill = Math.round(10 + level * 6.5 + (great ? rng.int(2, 8) : rng.int(-10, -3)))
          s.squad.push({
            id: s.nextId++,
            firstName: rng.pick(['Kacper', 'Oliwier', 'Antek', 'Franek', 'Szymek']),
            lastName: rng.pick(['Wójcik', 'Kos', 'Mróz', 'Brzoza', 'Kania']),
            age: 16,
            pos: 'NAP',
            skill,
            potential: skill + (great ? rng.int(18, 30) : rng.int(5, 12)),
            form: 1,
            morale: 90,
            traits: great ? ['talent'] : [],
            injuredFor: 0,
            suspendedFor: 0,
            yellows: 0,
            goals: 0,
            assists: 0,
            apps: 0,
            ratings: [],
            ratingSum: 0,
            progress: 0,
            benchStreak: 0,
            value: 2000,
            wage: 100,
          })
          return great
            ? 'Wnuk naprawdę strzela! Dziadek ogląda każdy trening.'
            : 'Wnuk strzela głównie z lewej w trybunę. Ale ma zapał.'
        },
      },
      {
        label: 'Niech wróci za rok',
        apply: ({ s }) => {
          trust(s, -1, 0, -4)
          return 'Dziadek obrażony i opowiada o tym w całej parafii. Wnuk zapisał się do rywala.'
        },
      },
    ],
  },
  {
    id: 'reklama_tv',
    minLevel: 6,
    once: true,
    text: 'Firma z branży pożyczek chce, żebyś wystąpił w ich reklamie. „Szybka gotówka jak szybka kontra”.',
    options: [
      {
        label: 'Bierz kasę',
        apply: ({ s }) => {
          coach(s, 0, -4, 20_000)
          scandal(s, 'Reklama chwilówek z trenerem w roli głównej')
          trust(s, 0, 0, -4)
          return 'Reklama leci w każdej przerwie. Kibice śpiewają przyśpiewkę o RRSO.'
        },
      },
      {
        label: 'Odmów',
        apply: ({ s }) => {
          coach(s, 0, 1)
          return 'Odmówiłeś. Reklamę nagrał trener rywala. Teraz to on jest memem.'
        },
      },
    ],
  },
  {
    id: 'mecz_pokazowy',
    minLevel: 4,
    text: 'Oldboje reprezentacji chcą zagrać mecz pokazowy z waszą drużyną na otwarcie nowego oświetlenia.',
    options: [
      {
        label: 'Zgódź się',
        apply: ({ s, rng }) => {
          s.budget += money(s, 800)
          trust(s, 2, 2, 8)
          if (rng.chance(0.25)) {
            const p = rng.pick(s.squad)
            p.injuredFor = 2
            return `Fantastyczne święto! Niestety ${p.firstName[0]}. ${p.lastName} został sfaulowany przez byłego reprezentanta. Dwa mecze przerwy.`
          }
          return 'Fantastyczne święto. Oldboje przegrali, ale wygrali w trzeciej połowie.'
        },
      },
      {
        label: 'Nie, skupiamy się na lidze',
        apply: ({ s }) => {
          trust(s, 0, 0, -3)
          return 'Kibice rozczarowani. Oświetlenie i tak włączono, przy meczu rezerw.'
        },
      },
    ],
  },
  {
    id: 'zona_trenera',
    once: true,
    text: 'Twoja partnerka mówi, że „albo ona, albo piłka”. Masz obiad o 18:00 i trening o 17:30.',
    options: [
      {
        label: 'Przełóż trening',
        apply: ({ s }) => {
          coach(s, -15)
          mod(s, 'Przełożony trening', -0.5, 1)
          return 'Obiad był pyszny. Trening przełożony. Zawodnicy nie protestowali.'
        },
      },
      {
        label: 'Trening to trening',
        apply: ({ s, rng }) => {
          trust(s, 2, 2, 0)
          if (rng.chance(0.4)) {
            coach(s, 15)
            scandal(s, 'Kryzys małżeński z powodu treningu we wtorek')
            return 'Spałeś przez tydzień w klubowym magazynie. Obok piłek i pachołków.'
          }
          return 'Trening udany, obiad zimny, ale związek przetrwał.'
        },
      },
    ],
  },
  {
    id: 'pilka_nowa',
    maxLevel: 4,
    text: 'Klub ma tylko 4 piłki, w tym jedną do siatkówki.',
    options: [
      {
        label: 'Kup nowe z budżetu',
        apply: ({ s }) => {
          const c = money(s, 300)
          s.budget -= c
          mod(s, 'Nowe piłki', 0.5, 3)
          return `Nowe piłki kosztowały ${k(c)}. Zawodnicy zachwyceni, że są okrągłe.`
        },
      },
      {
        label: 'Ogłoś zbiórkę w gminie',
        apply: ({ s }) => {
          trust(s, 0, 0, 5)
          return 'Mieszkańcy przynieśli 11 piłek, ponton i deskorolkę.'
        },
      },
    ],
  },
  {
    id: 'kibic_z_mlyna',
    player: 'kibic_z_mlyna',
    text: '{p} po golu pobiegł do sektora kibiców i odpalił z nimi racę. Sędzia ukarał klub.',
    options: [
      {
        label: 'Zapłać karę i nic nie mów',
        apply: ({ s }) => {
          const c = money(s, 500)
          s.budget -= c
          trust(s, -2, 0, 6)
          return `Kara: ${k(c)}. Kibice kochają {ps} jeszcze bardziej.`
        },
      },
      {
        label: 'Potrąć karę z jego pensji',
        apply: ({ s, p }) => {
          setMorale(p!, -15)
          trust(s, 2, -2, -8)
          return 'Kibice wywiesili transparent w obronie {ps}. I odpalili kolejną racę.'
        },
      },
    ],
  },
  {
    id: 'narwany_bojka',
    player: 'narwany',
    text: '{p} pokłócił się na treningu z kolegą z drużyny. Poszły pięści.',
    options: [
      {
        label: 'Zawieś go na mecz',
        apply: ({ s, p }) => {
          p!.suspendedFor = Math.max(p!.suspendedFor, 1)
          setMorale(p!, -10)
          trust(s, 2, 3, 0)
          return '{ps} pauzuje mecz za karę. Szatnia docenia, że są zasady.'
        },
      },
      {
        label: 'Niech sobie wyjaśnią sami',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            trust(s, 0, 3, 0)
            return 'Po treningu wypili razem piwo. Najlepsi kumple.'
          }
          trust(s, 0, -6, 0)
          mod(s, 'Konflikt w szatni', -1.5, 3)
          return 'Konflikt się pogłębia. Szatnia podzielona na dwa obozy.'
        },
      },
    ],
  },
  {
    id: 'leniwy_trening',
    player: 'leniwy',
    text: '{p} od trzech treningów „przypadkiem” spóźnia się na rozgrzewkę i wcześnie wychodzi.',
    options: [
      {
        label: 'Indywidualny plan treningowy',
        apply: ({ p, rng }) => {
          if (rng.chance(0.4)) {
            p!.traits = p!.traits.filter((t) => t !== 'leniwy')
            p!.progress += 1.5
            return '{ps} zaskoczył wszystkich i zaczął biegać. Podobno zakochał się w fizjoterapeutce.'
          }
          setMorale(p!, -6)
          nudgeForm(p!, -1)
          return '{ps} zgubił plan treningowy. Dwa razy. Forma też gdzieś się zgubiła.'
        },
      },
      {
        label: 'Odsuń go od składu',
        apply: ({ s, p }) => {
          setMorale(p!, -20)
          trust(s, 2, 2, 0)
          return '{ps} odsunięty. Szatnia widzi, że zasady obowiązują wszystkich.'
        },
      },
    ],
  },
  {
    id: 'prognoza',
    text: 'Prasa przed sezonem dała drużynie miano „murowanego kandydata do spadku”.',
    condition: (s) => s.round < 6,
    options: [
      {
        label: 'Powieś artykuł w szatni',
        apply: ({ s }) => {
          teamMorale(s, 8)
          mod(s, 'Sportowa złość', 1, 3)
          return 'Artykuł wisi nad wejściem. Każdy zawodnik go uderza przed meczem.'
        },
      },
      {
        label: 'Zignoruj',
        apply: ({ s }) => {
          coach(s, -4)
          trust(s, 0, 0, -3)
          return 'Zignorowałeś. Trener śpi spokojnie, ale kibice uznali, że prasa ma rację.'
        },
      },
    ],
  },
  {
    id: 'sponsor_bukmacher',
    minLevel: 7,
    once: true,
    text: 'Bukmacher chce wykupić nazwę stadionu. Nowa nazwa: „Kursowo Arena”.',
    options: [
      {
        label: 'Bierzemy!',
        apply: ({ s }) => {
          s.budget += money(s, 3000)
          s.wageLimit = Math.round(s.wageLimit * 1.08)
          trust(s, 6, 0, -6)
          return '„Kursowo Arena” brzmi okropnie, ale budżet i limit pensji wyglądają pięknie.'
        },
      },
      {
        label: 'Tradycja jest bezcenna',
        apply: ({ s }) => {
          trust(s, -5, 0, 8)
          return 'Kibice zrobili oprawę z napisem „Nie na sprzedaż”. Prezes liczy straty.'
        },
      },
    ],
  },
  {
    id: 'dron',
    minLevel: 5,
    text: 'Nad boiskiem treningowym lata dron. Podobno to szpieg rywala.',
    options: [
      {
        label: 'Trenuj fałszywą taktykę',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            mod(s, 'Rywal oszukany', 1.5, 1)
            return 'Rywale przygotują się na 3-4-3, a wy zagracie swoje. Sprytne!'
          }
          mod(s, 'Pomylona taktyka', -1.5, 1)
          return 'Zawodnicy pomylili fałszywą taktykę z prawdziwą. Chaos.'
        },
      },
      {
        label: 'Strąć go piłką',
        apply: ({ s }) => {
          trust(s, 0, 5, 3)
          return 'Kapitan trafił drona z 40 metrów. Lepiej niż w ostatnim meczu.'
        },
      },
    ],
  },
  {
    id: 'lekcja_wf',
    maxLevel: 5,
    text: 'Szkoła podstawowa prosi Cię o poprowadzenie zajęć WF. „Dzieci chcą trenera z prawdziwego klubu”.',
    options: [
      {
        label: 'Poprowadź zajęcia',
        apply: ({ s }) => {
          trust(s, 2, 0, 6)
          coach(s, -5, 1)
          return 'Dzieci zachwycone. Trzech chłopaków zapisało się do akademii klubu.'
        },
      },
      {
        label: 'Nie mam czasu',
        apply: ({ s }) => {
          trust(s, -1, 0, -4)
          return 'Zajęcia poprowadził katecheta. Grali w dwa ognie, a rodzice zapamiętali, kto odmówił.'
        },
      },
    ],
  },

  // ---------- piłka zawodowa (III liga wzwyż) ----------
  {
    id: 'tabloid_klub_nocny',
    minLevel: 6,
    player: (p) => p.traits.includes('imprezowicz') || (p.age <= 25 && p.apps >= 3),
    text: 'Tabloid publikuje zdjęcia {p} z klubu nocnego w centrum miasta. Godzina 3:40, dwa dni przed meczem. Portal dopisał „ekskluzywnie”.',
    options: [
      {
        label: 'Kara regulaminowa i oświadczenie klubu',
        apply: ({ s, p }) => {
          setMorale(p!, -15)
          trust(s, 4, -1, 1)
          return '{ps} płaci karę z regulaminu wewnętrznego. Rzecznik wydał oświadczenie, temat przycichł po dobie.'
        },
      },
      {
        label: 'Bronić go: „był na urodzinach brata”',
        apply: ({ s, p, rng }) => {
          setMorale(p!, 10)
          if (rng.chance(0.45)) {
            scandal(s, 'Kolejne zdjęcia z klubu nocnego, tym razem z butelką')
            trust(s, -8, 2, -4)
            coach(s, 6, -1)
            return 'Następnego dnia tabloid dorzucił kolejne zdjęcia. Brat {ps} był wtedy w Norwegii.'
          }
          trust(s, -2, 4, 0)
          return 'Wersja się obroniła. Szatnia widzi, że trener staje za swoimi.'
        },
      },
      {
        label: 'Odsuń go do rezerw na tydzień',
        apply: ({ s, p }) => {
          setMorale(p!, -22)
          nudgeForm(p!, -1)
          trust(s, 5, -3, 2)
          return '{ps} trenuje z rezerwami. Agent już dzwoni do dyrektora sportowego.'
        },
      },
    ],
  },
  {
    id: 'wpis_social_media',
    minLevel: 6,
    player: (p) => p.apps >= 2,
    text: '{p} wrzucił w nocy wpis: „Niektórzy w tym klubie nie wiedzą, co to ambicja”. Usunął po godzinie, ale screenshoty już krążą.',
    options: [
      {
        label: 'Rozmowa i publiczne przeprosiny',
        apply: ({ s, p }) => {
          setMorale(p!, -6)
          trust(s, 3, 2, 0)
          return '{ps} nagrał przeprosiny z klubowej sali konferencyjnej. Brzmiał jak zakładnik, ale sprawa zamknięta.'
        },
      },
      {
        label: 'Szkolenie medialne dla całej kadry',
        apply: ({ s }) => {
          const c = money(s, 250)
          s.budget -= c
          trust(s, 2, -2, 0)
          coach(s, -2, 1)
          return `Agencja PR przez trzy godziny tłumaczyła zawodnikom, czym jest „kryzys wizerunkowy” (${k(c)}). Połowa scrollowała telefony.`
        },
      },
      {
        label: 'Zapytaj go, kogo miał na myśli',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.5)) {
            setMorale(p!, 8)
            trust(s, 0, 4, 0)
            mod(s, 'Oczyszczona atmosfera', 1, 2)
            return '{ps} wskazał problem z intensywnością treningów. Miał trochę racji. Szatnia doceniła szczerość.'
          }
          trust(s, -2, -6, 0)
          mod(s, 'Konflikt w szatni', -1.5, 2)
          return '{ps} wymienił trzy nazwiska. Na odprawie było cicho jak w bibliotece.'
        },
      },
    ],
  },
  {
    id: 'influencerka',
    minLevel: 7,
    player: (p) => p.age <= 29 && p.benchStreak >= 2,
    text: 'Partnerka {p}, influencerka z 600 tysiącami obserwujących, wrzuca relację: „Ciekawe, ile jeszcze ten trener będzie niszczył mu karierę”.',
    options: [
      {
        label: 'Nie komentuj, wystaw go w następnym meczu',
        apply: ({ s, p }) => {
          setMorale(p!, 12)
          s.flags[`obietnica:${p!.id}`] = s.round
          trust(s, -2, -3, 0)
          coach(s, 3)
          return '{ps} zagra. Szatnia zastanawia się, czy do składu wchodzi się teraz przez Instagram.'
        },
      },
      {
        label: 'Zakaz publikacji z wnętrza klubu',
        apply: ({ s, p }) => {
          setMorale(p!, -10)
          trust(s, 3, 2, 0)
          return 'Dział komunikacji wprowadza zakaz. Influencerka wrzuca relację o „cenzurze”, ale zasięgi już nie te.'
        },
      },
      {
        label: 'Zaproponuj jej współpracę z klubem',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.55)) {
            s.budget += money(s, 400)
            trust(s, 2, 0, 4)
            setMorale(p!, 6)
            return 'Influencerka prowadzi teraz kampanię karnetową. Sprzedaż w górę, krytyka trenera zniknęła z profilu.'
          }
          trust(s, -3, -2, -2)
          scandal(s, 'Influencerka publikuje prywatne wiadomości od klubu')
          return 'Influencerka opublikowała screena propozycji z podpisem „próbują mnie kupić”. Klasyka.'
        },
      },
    ],
  },
  {
    id: 'oferta_egzotyczna',
    minLevel: 7,
    player: (p, s) => p.age >= 27 && p.skill >= median(s) && p.apps >= 3,
    text: 'Klub z ligi saudyjskiej oferuje {p} kontrakt życia: trzy razy więcej niż zarabia u nas. Zawodnik przychodzi i mówi wprost, że chce odejść.',
    options: [
      {
        label: 'Sprzedaj go',
        apply: ({ s, p }) => {
          const fee = Math.round(p!.value * 1.4)
          s.budget += fee
          removePlayer(s, p!)
          trust(s, 4, -2, -3)
          return `{ps} leci do Rijadu. Klub zarabia ${k(fee)}, kibice żegnają go mieszanymi uczuciami.`
        },
      },
      {
        label: 'Nie puszczaj, ma ważny kontrakt',
        apply: ({ s, p }) => {
          setMorale(p!, -25)
          nudgeForm(p!, -1)
          trust(s, 0, -2, 2)
          return '{ps} zostaje. Na treningach jest, ale głową już na pustyni.'
        },
      },
      {
        label: 'Zatrzymaj go podwyżką o 30%',
        apply: ({ s, p }) => {
          p!.wage = Math.round((p!.wage * 1.3) / 100) * 100
          setMorale(p!, 10)
          trust(s, -2, -2, 3)
          return '{ps} zostaje za lepsze pieniądze. Dyrektor finansowy przelicza siatkę płac i wzdycha.'
        },
      },
    ],
  },
  {
    id: 'agent_transfer',
    minLevel: 6,
    player: (p, s) => p.age <= 25 && p.skill >= median(s),
    text: 'Agent {p} udziela wywiadów, że „chłopak przerósł ten klub” i „jest gotowy na ligę belgijską”. Zawodnik milczy.',
    options: [
      {
        label: 'Zakaz wstępu dla agenta na obiekty klubu',
        apply: ({ s, p }) => {
          setMorale(p!, -12)
          trust(s, 4, 0, 3)
          coach(s, 3)
          return 'Agent ma zakaz wstępu. Zapowiada, że „o wszystkim zdecyduje klauzula”.'
        },
      },
      {
        label: 'Porozmawiaj z zawodnikiem bez agenta',
        apply: ({ p, rng }) => {
          if (rng.chance(0.6)) {
            setMorale(p!, 10)
            p!.progress += 0.3
            return '{ps} przyznał, że chce jeszcze sezon pograć u nas. Agent dowiedział się ostatni.'
          }
          setMorale(p!, -8)
          return '{ps} grzecznie słuchał i powtarzał: „proszę rozmawiać z moim menedżerem”.'
        },
      },
      {
        label: 'Ogłoś, że czekacie na oferty',
        apply: ({ s, p }) => {
          setMorale(p!, 6)
          nudgeForm(p!, -1)
          trust(s, 2, -2, -3)
          return '{ps} odlicza dni do okna transferowego. Dobrze dla budżetu, gorzej dla koncentracji.'
        },
      },
    ],
  },
  {
    id: 'kontrola_antydopingowa',
    minLevel: 6,
    player: (p) => p.apps >= 2,
    text: 'Po kontroli antydopingowej {p} przyznaje, że brał suplement z zagranicznego sklepu internetowego. Lekarz klubowy blednie, czytając skład.',
    options: [
      {
        label: 'Zgłoś sprawę i odsuń go do wyników',
        apply: ({ s, p, rng }) => {
          p!.suspendedFor = Math.max(p!.suspendedFor, 1)
          setMorale(p!, -10)
          trust(s, 4, 0, 0)
          coach(s, 0, 1)
          if (rng.chance(0.75)) return 'Wynik próbki czysty. {ps} wraca po meczu przerwy, a lekarz robi wykład o suplementach.'
          p!.suspendedFor = 4
          return 'Próbka pozytywna, ale współpraca z komisją złagodziła karę: {ps} pauzuje cztery mecze.'
        },
      },
      {
        label: 'Gra normalnie, czekamy na wynik',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.7)) {
            setMorale(p!, 4)
            return 'Wynik negatywny. Lekarz i tak wyrzucił z szatni wszystkie słoiki z napisami cyrylicą.'
          }
          p!.suspendedFor = 8
          setMorale(p!, -25)
          trust(s, -8, -2, -5)
          scandal(s, 'Pozytywny wynik testu antydopingowego')
          coach(s, 8, -2)
          return 'Wynik pozytywny. {ps} zawieszony na osiem meczów, a media pytają, co działo się w sztabie medycznym.'
        },
      },
      {
        label: 'Kontrola wszystkich suplementów w kadrze',
        apply: ({ s }) => {
          const c = money(s, 200)
          s.budget -= c
          trust(s, 3, -1, 0)
          coach(s, -2)
          return `Dietetyk i lekarz przejrzeli wszystkie szafki (${k(c)}). Znaleźli też dwie kanapki z zeszłego miesiąca.`
        },
      },
    ],
  },
  {
    id: 'powolanie_kadra',
    minLevel: 8,
    player: (p, s) => p.skill >= topSkill(s, 3) && p.injuredFor === 0 && p.age >= 19,
    text: '{p} dostał powołanie do reprezentacji. Selekcjoner planuje dać mu po 90 minut w obu meczach, a wy gracie zaraz po przerwie.',
    options: [
      {
        label: 'Pogratuluj, niech jedzie i gra',
        apply: ({ s, p, rng }) => {
          setMorale(p!, 15)
          coach(s, 0, 2)
          trust(s, 2, 0, 3)
          if (rng.chance(0.3)) {
            p!.injuredFor = Math.max(p!.injuredFor, rng.int(2, 4))
            return `{ps} zagrał świetnie, ale w drugim meczu naciągnął mięsień dwugłowy. Wraca do klubu z kontuzją: ${p!.injuredFor} meczów.`
          }
          return '{ps} wrócił z kadry z golem i nową pewnością siebie.'
        },
      },
      {
        label: 'Zadzwoń do sztabu kadry w sprawie obciążeń',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.6)) {
            trust(s, 2, 0, 0)
            return 'Sztab kadry przysłał plan minutowy. {ps} zagrał jeden mecz i wrócił świeży.'
          }
          setMorale(p!, -6)
          coach(s, 3, -1)
          return 'W studiu telewizyjnym przez pół wieczoru dyskutowano, czy klub „sabotuje reprezentację”.'
        },
      },
      {
        label: 'Zgłoś mikrouraz i zatrzymaj go w klubie',
        apply: ({ s, p }) => {
          setMorale(p!, -18)
          trust(s, 1, -2, -6)
          scandal(s, 'Podejrzane zgłoszenie urazu przed zgrupowaniem kadry')
          return '{ps} zostaje w klubie, ale wściekły. Kibice pytają, od kiedy klub jest ważniejszy niż orzeł na piersi.'
        },
      },
    ],
  },
  {
    id: 'oboz_turcja',
    minLevel: 6,
    text: 'Dyrektor sportowy przedstawia plan zimowego zgrupowania: dwa tygodnie w Turcji ze sparingami z ukraińskimi i skandynawskimi zespołami albo krajowy ośrodek w górach.',
    options: [
      {
        label: 'Turcja, pełen pakiet',
        apply: ({ s }) => {
          const c = money(s, 900)
          s.budget -= c
          mod(s, 'Forma z tureckiego zgrupowania', 1.5, 3)
          coach(s, -4)
          return `Zgrupowanie w Belek (${k(c)}). Boiska jak dywan, sparingi z wymagającymi rywalami, zero śniegu.`
        },
      },
      {
        label: 'Krajowy ośrodek w górach',
        apply: ({ s, rng }) => {
          const c = money(s, 350)
          s.budget -= c
          if (rng.chance(0.5)) {
            mod(s, 'Wydolność z gór', 1, 2)
            return `Treningi na wysokości, sauna, odnowa (${k(c)}). Tanio i solidnie.`
          }
          mod(s, 'Zgrupowanie w śniegu', -0.5, 2)
          return `Śnieg przykrył boiska, sparingi odwołane, drużyna trenowała na hali (${k(c)}).`
        },
      },
      {
        label: 'Bez zgrupowania, trenujemy u siebie',
        apply: ({ s }) => {
          trust(s, 2, -4, 0)
          teamMorale(s, -4)
          return 'Zarząd zadowolony z oszczędności. Zawodnicy oglądają na Instagramie zdjęcia rywali z palmami.'
        },
      },
    ],
  },
  {
    id: 'premia_awans',
    minLevel: 6,
    condition: (s) => s.round >= 6 && s.streak.slice(-4).filter((x) => x === 'W').length >= 2,
    text: 'Rada drużyny przynosi pismo: chce zapisania premii za awans w regulaminie, zanim „sprawa się rozstrzygnie”. Prezes uważa, że „premią jest sam awans”.',
    options: [
      {
        label: 'Wywalcz dla nich pełną premię',
        apply: ({ s }) => {
          const c = money(s, 1200)
          s.budget -= c
          trust(s, -4, 8, 0)
          teamMorale(s, 10)
          mod(s, 'Premia na stole', 1, 3)
          return `Premia zapisana: ${k(c)} do podziału. Szatnia gra jak o swoje, bo gra o swoje.`
        },
      },
      {
        label: 'Kompromis: premia za punkty',
        apply: ({ s }) => {
          const c = money(s, 400)
          s.budget -= c
          trust(s, 1, 3, 0)
          teamMorale(s, 4)
          return `Ustalono premię meczową za każdy punkt (${k(c)} na start). Nikt nie jest zachwycony, wszyscy podpisali.`
        },
      },
      {
        label: 'Stań po stronie prezesa',
        apply: ({ s }) => {
          trust(s, 6, -8, 0)
          teamMorale(s, -8)
          coach(s, 4)
          return 'Rada drużyny wyszła bez słowa. Przez tydzień na treningach nikt nie żartował.'
        },
      },
    ],
  },
  {
    id: 'dyrektor_sklad',
    minLevel: 7,
    text: 'Dyrektor sportowy przysyła Ci przed meczem „sugestię” składu. Na liście jest zimowy nabytek, za którego klub zapłacił najwięcej w historii.',
    options: [
      {
        label: 'Wystaw zgodnie z sugestią',
        apply: ({ s }) => {
          trust(s, 6, -4, 0)
          mod(s, 'Skład z gabinetu', -1, 1)
          coach(s, 3)
          return 'Nabytek gra. Dyrektor zadowolony, szatnia wie już, kto naprawdę ustala skład.'
        },
      },
      {
        label: 'Skład ustala trener',
        apply: ({ s }) => {
          trust(s, -7, 5, 0)
          coach(s, 5, 1)
          return 'Odpisałeś krótko: „Dziękuję za sugestię”. Dyrektor przestał mówić Ci „dzień dobry”.'
        },
      },
      {
        label: 'Zaproś go na odprawę i pokaż dane',
        apply: ({ s, rng }) => {
          if (rng.chance(0.55)) {
            trust(s, 4, 2, 0)
            return 'Dyrektor obejrzał dane z treningów i przyznał, że nabytek „potrzebuje czasu”. Rzadka chwila zgody.'
          }
          trust(s, -3, -1, 0)
          coach(s, 4)
          return 'Dyrektor obejrzał dane i stwierdził, że „dane nie grają”. Spotkanie trwało dwie godziny.'
        },
      },
    ],
  },
  {
    id: 'konferencja_pulapka',
    minLevel: 7,
    text: 'Dziennikarz ogólnopolskiego portalu na konferencji: „Czy to prawda, że rozmawiał pan z innym klubem, a w szatni jest konflikt z kapitanem?”.',
    options: [
      {
        label: '„Nie komentuję plotek”',
        apply: ({ s }) => {
          trust(s, 0, 0, -1)
          coach(s, 2)
          return 'Nagłówek: „Trener nie zaprzecza”. Kliknęło się świetnie.'
        },
      },
      {
        label: 'Zdementuj stanowczo i z humorem',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            trust(s, 2, 3, 4)
            coach(s, -2, 1)
            return '„Jedyny konflikt z kapitanem dotyczy tego, kto płaci za kawę”. Sala się śmieje, temat zamknięty.'
          }
          trust(s, -2, 0, -2)
          coach(s, 4, -1)
          return 'Żart nie wyszedł. Fragment wycięto bez kontekstu i puszczono w kółko w studiu.'
        },
      },
      {
        label: 'Zablokuj portalowi akredytacje',
        apply: ({ s }) => {
          trust(s, 2, 2, -4)
          coach(s, 3, -2)
          scandal(s, 'Klub odbiera akredytację ogólnopolskiemu portalowi')
          return 'Portal napisał o „zamachu na wolność prasy”. Szatnia jest za Tobą, media już nie.'
        },
      },
    ],
  },
  {
    id: 'ultrasi_transparent',
    minLevel: 6,
    text: 'Ultrasi wywiesili na meczu transparent „Zarząd won!”. Komisja ligi wszczyna postępowanie, a prezes oczekuje, że trener publicznie potępi kibiców.',
    options: [
      {
        label: 'Potęp transparent',
        apply: ({ s }) => {
          trust(s, 6, 0, -8)
          return 'Zarząd docenia lojalność. Na następnym meczu doping był, ale jakby ciszej.'
        },
      },
      {
        label: 'Uciekaj od tematu: „Mówię o piłce”',
        apply: ({ s }) => {
          trust(s, -3, 0, -1)
          coach(s, 2)
          return 'Odpowiedź bez odpowiedzi. Obie strony uznały, że jesteś po stronie tej drugiej.'
        },
      },
      {
        label: '„Kibice mają prawo do swojego zdania”',
        apply: ({ s }) => {
          const c = money(s, 300)
          s.budget -= c
          trust(s, -8, 0, 9)
          coach(s, 4)
          return `Klub płaci karę za transparent (${k(c)}). Kibice skandują Twoje nazwisko, prezes już nie.`
        },
      },
    ],
  },
  {
    id: 'sponsor_techniczny',
    minLevel: 7,
    once: true,
    text: 'Kończy się umowa na stroje. Globalna marka sportowa daje więcej pieniędzy, polska firma odzieżowa obiecuje limitowane kolekcje i „DNA klubu”.',
    options: [
      {
        label: 'Globalna marka',
        apply: ({ s }) => {
          s.budget += money(s, 1600)
          s.wageLimit = Math.round(s.wageLimit * 1.04)
          trust(s, 5, 2, -2)
          return 'Nowe stroje wyglądają jak szablon z katalogu, ale budżet i limit płac rosną.'
        },
      },
      {
        label: 'Polska firma',
        apply: ({ s }) => {
          s.budget += money(s, 900)
          trust(s, 1, 0, 6)
          return 'Kolekcja z herbem z lat 70. wyprzedała się w dwa dni. Kibice zachwyceni.'
        },
      },
      {
        label: 'Negocjuj udział w sprzedaży koszulek',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            s.budget += money(s, 2000)
            trust(s, 6, 0, 2)
            return 'Udział w sprzedaży okazał się żyłą złota. Dział marketingu otwiera szampana bezalkoholowego.'
          }
          s.budget += money(s, 500)
          trust(s, -3, 0, 0)
          return 'Sprzedaż poniżej prognoz. Magazyn pełen koszulek w rozmiarze XXS.'
        },
      },
    ],
  },
  {
    id: 'odwolanie_var',
    minLevel: 7,
    player: (p) => p.suspendedFor >= 2,
    text: 'Po analizie VAR komisja ligi zawiesiła {p} na kilka meczów. Prawnik klubu uważa, że na powtórce z innej kamery widać, że ledwo musnął rywala.',
    options: [
      {
        label: 'Odwołanie z kancelarią prawną',
        apply: ({ s, p, rng }) => {
          const c = money(s, 300)
          s.budget -= c
          if (rng.chance(0.45)) {
            p!.suspendedFor = 1
            setMorale(p!, 12)
            trust(s, 2, 3, 2)
            return `Komisja odwoławcza skróciła karę do jednego meczu (${k(c)}). {ps} dziękuje prawnikom.`
          }
          trust(s, -2, 1, 0)
          return `Odwołanie oddalone (${k(c)}). W uzasadnieniu trzy strony o „intensywności kontaktu”.`
        },
      },
      {
        label: 'Przyjmij karę',
        apply: ({ s, p }) => {
          setMorale(p!, -6)
          trust(s, 2, -1, 0)
          return '{ps} pauzuje. Klub oszczędza na prawnikach, zawodnik na dobrym humorze nie.'
        },
      },
      {
        label: 'Publicznie skrytykuj sędziów VAR',
        apply: ({ s, p }) => {
          setMorale(p!, 8)
          trust(s, -4, 4, 4)
          coach(s, 3, -1)
          s.budget -= money(s, 150)
          scandal(s, 'Krytyka sędziów VAR na konferencji prasowej')
          return 'Kara za wypowiedź przyszła szybciej niż uzasadnienie zawieszenia. Szatnia jest jednak za Tobą.'
        },
      },
    ],
  },
  {
    id: 'akademia_cudowne_dziecko',
    minLevel: 7,
    player: (p) => p.age <= 19 && (p.traits.includes('talent') || p.potential >= p.skill + 12),
    text: 'Skauci klubu z Portugalii od miesiąca siedzą na meczach juniorów. Teraz oficjalnie: chcą {p}. Rodzice już oglądają mieszkania w Lizbonie.',
    options: [
      {
        label: 'Sprzedaj z procentem od następnego transferu',
        apply: ({ s, p }) => {
          const fee = Math.round(p!.value * 2.5)
          s.budget += fee
          removePlayer(s, p!)
          trust(s, 5, 0, -3)
          coach(s, 0, 3)
          return `{ps} odchodzi za ${k(fee)} plus 20% od kolejnego transferu. Akademia ma nowy plakat na ścianie.`
        },
      },
      {
        label: 'Pierwszy zawodowy kontrakt i plan rozwoju',
        apply: ({ s, p }) => {
          p!.wage = Math.round((p!.wage * 1.8 + 1000) / 100) * 100
          setMorale(p!, 15)
          p!.progress += 0.6
          trust(s, -2, 0, 5)
          return '{ps} podpisuje kontrakt do 2030 roku. Kibice wierzą, że wychowanek zostanie na dłużej.'
        },
      },
      {
        label: 'Odrzuć ofertę bez rozmów',
        apply: ({ s, p }) => {
          setMorale(p!, -18)
          nudgeForm(p!, -1)
          trust(s, -1, 0, 2)
          return '{ps} jest rozżalony, a agent rodziny zaczyna szukać klauzul w umowie szkoleniowej.'
        },
      },
    ],
  },
  {
    id: 'dzial_analiz',
    minLevel: 7,
    once: true,
    text: 'Szef działu analiz prosi o budżet na platformę danych, drugiego analityka i nowe kamizelki GPS. Prezentacja ma 48 slajdów.',
    options: [
      {
        label: 'Daj pełny budżet',
        apply: ({ s }) => {
          const c = money(s, 800)
          s.budget -= c
          mod(s, 'Przewaga analityczna', 1, 5)
          coach(s, -2, 2)
          return `Inwestycja: ${k(c)}. Po tygodniu wiesz, że lewy obrońca rywala nie lubi biegać do tyłu.`
        },
      },
      {
        label: 'Tylko kamizelki GPS',
        apply: ({ s }) => {
          const c = money(s, 250)
          s.budget -= c
          s.squad.forEach((p) => (p.progress += 0.1))
          return `Kamizelki kupione (${k(c)}). Sztab przygotowania motorycznego wreszcie wie, kto symuluje zmęczenie.`
        },
      },
      {
        label: 'Futbol to nie arkusz kalkulacyjny',
        apply: ({ s }) => {
          trust(s, 2, 0, 0)
          coach(s, 0, -1)
          return 'Analityk przyjął odmowę i trzy dni później dostał ofertę z klubu z Danii. Przyjął ją.'
        },
      },
    ],
  },
  {
    id: 'poniedzialek_1800',
    minLevel: 8,
    text: 'Nadawca przenosi wasz mecz na poniedziałek, godzina 18:00. Kibice zapowiadają bojkot, dział biletów liczy puste krzesełka.',
    options: [
      {
        label: 'Protestuj publicznie',
        apply: ({ s }) => {
          trust(s, -4, 0, 6)
          coach(s, 2)
          return 'Twoja wypowiedź o „kibicach, którzy pracują do 17:00” poszła w świat. Nadawca nie zmienił godziny.'
        },
      },
      {
        label: 'Przyjmij to: dodatkowy dzień regeneracji',
        apply: ({ s }) => {
          mod(s, 'Dzień więcej regeneracji', 0.5, 1)
          trust(s, 1, 0, -3)
          s.budget -= money(s, 150)
          return 'Zawodnicy wypoczęci, ale trybuny w połowie puste. Wpływy z biletów spadają.'
        },
      },
      {
        label: 'Akcja dla kibiców: darmowy transport i tańsze bilety',
        apply: ({ s }) => {
          const c = money(s, 250)
          s.budget -= c
          trust(s, 2, 0, 7)
          return `Klub dopłaca do autobusów i biletów (${k(c)}). Stadion pełny, nadawca chwali się ujęciami trybun.`
        },
      },
    ],
  },
  {
    id: 'wlasciciel_rozmowa',
    minLevel: 6,
    condition: (s) => s.trust.board < 40,
    text: 'Właściciel klubu zaprasza Cię na „rozmowę o kierunku projektu” do biura na 22. piętrze. W sekretariacie siedzi znany trener bez pracy.',
    options: [
      {
        label: 'Obiecaj wygraną w najbliższym meczu',
        apply: ({ s }) => {
          trust(s, 8, 0, 0)
          coach(s, 8)
          s.flags.obietnicaWygranej = s.round
          return 'Właściciel przyjął deklarację. Trener z sekretariatu też ją słyszał.'
        },
      },
      {
        label: 'Przedstaw raport z danymi i planem',
        apply: ({ s, rng }) => {
          if (rng.chance(0.55)) {
            trust(s, 10, 0, 0)
            return 'Właściciel lubi liczby. Wskaźnik xG po Twojej stronie, kredyt zaufania przedłużony.'
          }
          trust(s, -4, 0, 0)
          coach(s, 4)
          return '„xG nie wpisuje się do tabeli” – podsumował właściciel i zerknął na zegarek.'
        },
      },
      {
        label: 'Zażądaj wzmocnień w zimowym oknie',
        apply: ({ s, rng }) => {
          if (rng.chance(0.45)) {
            s.budget += money(s, 800)
            trust(s, 2, 3, 0)
            return 'Właściciel dorzuca pieniądze na transfery. „Ale to ostatni raz” – dodaje przy drzwiach.'
          }
          trust(s, -8, 2, 0)
          coach(s, 6)
          return 'Właściciel uznał, że trener „szuka wymówek”. Znany trener z sekretariatu uśmiechnął się pod nosem.'
        },
      },
    ],
  },
  {
    id: 'kontuzja_kadra_mlodziezowa',
    minLevel: 6,
    maxLevel: 7,
    player: (p) => p.age <= 21 && p.apps >= 2 && p.injuredFor === 0,
    text: '{p} dostał powołanie do młodzieżowej reprezentacji na zgrupowanie w środku rundy. Klub może poprosić PZPN o zwolnienie.',
    options: [
      {
        label: 'Puść go, to wyróżnienie',
        apply: ({ s, p, rng }) => {
          setMorale(p!, 12)
          p!.progress += 0.4
          trust(s, 1, 0, 3)
          if (rng.chance(0.2)) {
            p!.injuredFor = Math.max(p!.injuredFor, 2)
            return '{ps} wrócił z kadry z doświadczeniem i skręconą kostką. Dwa mecze przerwy.'
          }
          return '{ps} wrócił z kadry pewniejszy siebie. Skauci zapisali nazwisko.'
        },
      },
      {
        label: 'Poproś o zwolnienie, jest potrzebny',
        apply: ({ s, p }) => {
          setMorale(p!, -12)
          trust(s, 2, 0, -2)
          return '{ps} zostaje w klubie. Przez tydzień nie odzywa się do nikogo ze sztabu.'
        },
      },
    ],
  },
]
