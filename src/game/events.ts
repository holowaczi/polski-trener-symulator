import type { Rng } from './rng'
import type { GameState, Player, TraitId } from './types'
import { addModifier, adjustCoach, adjustTrust, nudgeForm, setMorale } from './util'
import { addDirt, DIRT_SCANDAL } from './endings'

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
  /** zdarzenie jednorazowe (emerytura, ślub, otwarcie stadionu, nowy sponsor): zdarza się najwyżej raz w karierze */
  once?: boolean
  /** minimalna liczba innych zdarzeń, które muszą się wydarzyć, zanim to zdarzenie może się powtórzyć (domyślnie 30) */
  cooldown?: number
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
const scandal = (s: GameState, text: string) => {
  s.scandals.push(text)
  addDirt(s, DIRT_SCANDAL)
}
const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)} tys. zł` : `${v} zł`)
/** kwota zależna od poziomu ligi */
const money = (s: GameState, base: number) => Math.round(base * Math.pow(2.2, s.teams[s.clubId!].level))
/** płaci z budżetu klubu tylko wtedy, gdy klub ma te pieniądze; zwraca, czy zapłacono */
const pay = (s: GameState, c: number) => {
  if (s.budget < c) return false
  s.budget -= c
  return true
}
/** kara, której nie da się uniknąć: klub oddaje tyle, ile ma, ale budżet nie spada poniżej zera; zwraca pobraną kwotę */
const fine = (s: GameState, c: number) => {
  const x = Math.min(c, Math.max(0, s.budget))
  s.budget -= x
  return x
}
/** płaci z oszczędności trenera tylko wtedy, gdy go stać; zwraca, czy zapłacono */
const paySelf = (s: GameState, c: number) => {
  if (s.coach.savings < c) return false
  coach(s, 0, 0, -c)
  return true
}
const last3 = (s: GameState) => s.streak.slice(-3).join('')
const median = (s: GameState) => [...s.squad].sort((a, b) => b.skill - a.skill)[Math.min(13, s.squad.length - 1)]?.skill ?? 0
/** umiejętność n-tego najlepszego zawodnika kadry */
const topSkill = (s: GameState, n: number) => [...s.squad].sort((a, b) => b.skill - a.skill)[Math.min(n - 1, s.squad.length - 1)]?.skill ?? 0

export const EVENTS: GameEvent[] = [
  // ---------- zdarzenia wynikające z meczów ----------
  {
    id: 'lawka_skarga',
    weight: 2.5,
    cooldown: 10,
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
        label: '„Jak ci źle, w oknie poszukasz klubu”',
        apply: ({ s, p }) => {
          setMorale(p!, -25)
          trust(s, 0, -3, 0)
          return '{ps} wychodzi bez słowa i do wieczora przegląda ogłoszenia klubów. Atmosfera w szatni gęstnieje.'
        },
      },
    ],
  },
  {
    id: 'czerwona_kara',
    weight: 3,
    cooldown: 10,
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
    cooldown: 10,
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
          if (!pay(s, c)) {
            setMorale(p!, 4)
            return 'Na psychologa w kasie brak. Kierownik drużyny pożyczył {ps} poradnik „Pokonaj kryzys w 7 dni”. Jest dzień pierwszy.'
          }
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
    cooldown: 12,
    player: (p) => p.form >= 2 && p.apps >= 4,
    text: '{p} gra jak natchniony, średnia {ocena}. W mieście wszyscy o nim mówią, a on coraz częściej wspomina o podwyżce.',
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
    cooldown: 15,
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
          if (!pay(s, c)) {
            trust(s, 0, 5, 0)
            coach(s, -6)
            mod(s, 'Odbudowana atmosfera', 0.5, 2)
            return 'Na hotel nie ma pieniędzy, więc jest ognisko za boiskiem i namioty. Drużyna znów jest drużyną, choć trochę pogryzioną przez komary.'
          }
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
    cooldown: 15,
    condition: (s) => last3(s) === 'WWW',
    text: 'Trzy wygrane z rzędu! W mieście mówi się już o „projekcie {trener}”. Jak to wykorzystać?',
    options: [
      {
        label: 'Premia dla drużyny',
        apply: ({ s }) => {
          const c = money(s, 500)
          if (!pay(s, c)) {
            trust(s, 0, 2, 0)
            teamMorale(s, 3)
            return 'Księgowa pokazała stan konta i premia skończyła się na pizzy. Zawodnicy docenili gest, choć liczyli na coś więcej niż hawajską.'
          }
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
    cooldown: 12,
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
          if (!paySelf(s, 500)) {
            coach(s, -10)
            return 'Na zajęcia jogi Cię nie stać, więc ćwiczysz z filmikiem z internetu. Melisa z marketu też działa.'
          }
          coach(s, -15)
          return 'Poranna joga w szatni (500 zł z Twojej kieszeni). Bramkarz też się przyłączył i podobno lepiej skacze.'
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
    cooldown: 10,
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
    cooldown: 15,
    player: (p) => p.age <= 20 && p.benchStreak >= 3,
    text: 'Ojciec młodego {p} czeka pod szatnią. „Chłopak trenuje jak szalony, a pan go nie widzi”.',
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
        label: 'Indywidualne treningi z asystentem',
        apply: ({ p }) => {
          p!.progress += 0.6
          setMorale(p!, -3)
          return '{ps} dostaje dodatkowe zajęcia z asystentem. Ojciec przychodzi je oglądać i robi notatki.'
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
    once: true,
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
    maxLevel: 4,
    cooldown: 60,
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
    maxLevel: 4,
    once: true,
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
    maxLevel: 4,
    cooldown: 20,
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
    maxLevel: 4,
    cooldown: 15,
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
    maxLevel: 4,
    cooldown: 40,
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
          if (!pay(s, c)) {
            trust(s, -2, 0, 0)
            mod(s, 'Własne kartoflisko', 0.5, 1)
            return 'Firma z walcem zażądała przedpłaty, a w kasie pusto. Boisko wyrównano grabiami prezesa, mniej więcej.'
          }
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
    cooldown: 20,
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
    minLevel: 6,
    cooldown: 20,
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
    cooldown: 20,
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
    cooldown: 60,
    text: 'Prezes proponuje krótki obóz przygotowawczy. Do wyboru: Zakopane albo „ośrodek u szwagra pod Grójcem”.',
    options: [
      {
        label: 'Zakopane',
        apply: ({ s }) => {
          const c = money(s, 1200)
          if (!pay(s, c)) {
            trust(s, -2, -2, 0)
            return 'Księgowa przypomniała, że na Zakopane nie ma pieniędzy. Prezes obraził się, że w ogóle zapytałeś.'
          }
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
    once: true,
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
    cooldown: 15,
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
    minLevel: 6,
    cooldown: 60,
    player: (p) => p.traits.includes('talent') && p.age <= 23,
    text: '{p} dostał zaproszenie na tygodniowy staż w klubie z Bundesligi. Puszczasz go w trakcie rundy?',
    options: [
      {
        label: 'Puść go, niech się rozwija',
        apply: ({ s, p, rng }) => {
          p!.injuredFor = Math.max(p!.injuredFor, 1)
          if (rng.chance(0.3)) {
            p!.progress += 1
            setMorale(p!, 15)
            coach(s, 0, 3)
            s.flags[`staz:${p!.id}`] = s.season
            return '{ps} zrobił furorę na stażu. Niemcy zapowiadają, że „wrócą do tematu w oknie transferowym”. Ty zyskujesz opinię wychowawcy.'
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
    cooldown: 15,
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
    once: true,
    text: 'Pani Halinka, która od 30 lat pierze stroje, odchodzi na emeryturę. Nikt nie wie, jak działa pralka.',
    options: [
      {
        label: 'Zatrudnij następcę',
        apply: ({ s }) => {
          const c = money(s, 500)
          if (!pay(s, c)) {
            teamMorale(s, -2)
            return 'Na nową panią od prania nie ma pieniędzy. Stroje pierze kierownik drużyny, wszystkie w 90 stopniach.'
          }
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
          fine(s, money(s, 300))
          return 'Pani Halinka odmówiła. „Panie, ja już mam wnuki do prania”. Pralnia w mieście liczy sobie sporo.'
        },
      },
    ],
  },
  {
    id: 'wyjazd_bus',
    maxLevel: 5,
    cooldown: 40,
    text: 'Klubowy bus zepsuł się w drodze na mecz wyjazdowy. Do rozpoczęcia 90 minut.',
    options: [
      {
        label: 'Zamów taksówki',
        apply: ({ s }) => {
          const c = money(s, 400)
          if (!pay(s, c)) {
            mod(s, 'Spóźnieni na rozgrzewkę', -1, 1)
            return 'Na taksówki zabrakło, więc kibice zawieźli drużynę prywatnymi autami. Dotarli na styk, bez rozgrzewki.'
          }
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
    once: true,
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
    cooldown: 10,
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
    cooldown: 20,
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
    cooldown: 20,
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
    cooldown: 40,
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
    cooldown: 40,
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
    once: true,
    text: 'Na trening przyszedł zawodnik z Brazylii. Twierdzi, że grał w młodzieżówce wielkiego klubu z São Paulo. Nikt tego nie może sprawdzić, a okno transferowe i tak jest zamknięte.',
    options: [
      {
        label: 'Niech trenuje z nami do okna',
        apply: ({ s, rng }) => {
          trust(s, 0, 0, 4)
          if (rng.chance(0.4)) {
            teamMorale(s, 5)
            mod(s, 'Samba na treningu', 0.5, 2)
            s.flags.brazylijczyk = s.season
            return 'Brazylijczyk naprawdę umie grać! Na treningach podkręca piłkę, a kibice już ćwiczą przyśpiewki po portugalsku. Źle, ale z sercem.'
          }
          teamMorale(s, 2)
          return 'Brazylijczyk grał w młodzieżówce, ale chyba w siatkówkę. Na treningach głównie uczy wszystkich tańczyć po golu.'
        },
      },
      {
        label: 'Podziękuj',
        apply: ({ s }) => {
          trust(s, 0, 0, -3)
          return 'Brazylijczyk poszedł trenować do rywala zza miedzy. Kibice pytają, czemu u nas zawsze „nie ma budżetu”.'
        },
      },
    ],
  },
  {
    id: 'dotacja_gmina',
    maxLevel: 5,
    cooldown: 60,
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
    cooldown: 10,
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
    cooldown: 20,
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
    maxLevel: 4,
    cooldown: 60,
    condition: (s) => s.squad.length < 27,
    text: 'Dziadek przyprowadził na trening wnuka. „Strzela z lewej jak kapitan reprezentacji z prawej”. Chłopak nigdy nie był nigdzie zgłoszony, więc można go zarejestrować od ręki.',
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
    once: true,
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
    maxLevel: 3,
    once: true,
    text: 'Klub ma tylko 4 piłki, w tym jedną do siatkówki.',
    options: [
      {
        label: 'Kup nowe z budżetu',
        apply: ({ s }) => {
          const c = money(s, 300)
          if (!pay(s, c)) {
            trust(s, 0, -1, 0)
            return 'W kasie nie ma nawet na piłki. Prezes obiecał, że „coś się wymyśli”, i wyszedł z jedną pod pachą.'
          }
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
    cooldown: 20,
    text: '{p} po golu pobiegł do sektora kibiców i odpalił z nimi racę. Sędzia ukarał klub.',
    options: [
      {
        label: 'Zapłać karę i nic nie mów',
        apply: ({ s }) => {
          const c = fine(s, money(s, 500))
          trust(s, -2, 0, 6)
          return c > 0 ? `Kara: ${k(c)}. Kibice kochają {ps} jeszcze bardziej.` : 'Kasa klubu jest pusta, więc karę rozłożono na raty. Kibice kochają {ps} jeszcze bardziej.'
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
    cooldown: 15,
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
    cooldown: 15,
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
    cooldown: 60,
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
    minLevel: 6,
    cooldown: 40,
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
    cooldown: 40,
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
    cooldown: 20,
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
    cooldown: 20,
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
          if (!pay(s, c)) {
            trust(s, 1, -1, 0)
            return 'Na agencję PR nie ma pieniędzy, więc szkolenie poprowadził rzecznik z prezentacji z 2012 roku. Połowa scrollowała telefony.'
          }
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
    cooldown: 40,
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
    cooldown: 60,
    player: (p, s) => p.age >= 27 && p.skill >= median(s) && p.apps >= 3,
    text: 'Agent {p} wraca z Bliskiego Wschodu: klub z ligi saudyjskiej chce go w najbliższym oknie i obiecuje kontrakt życia. Zawodnik przychodzi i mówi wprost, że chce o tym rozmawiać.',
    options: [
      {
        label: 'Obiecaj rozmowy w oknie transferowym',
        apply: ({ s, p }) => {
          setMorale(p!, 8)
          trust(s, 2, -1, -3)
          s.flags[`saudyjczycy:${p!.id}`] = s.season
          return '{ps} wie, że klub nie będzie blokował rozmów. Do okna gra dalej, choć w szatni już wołają na niego „szejk”.'
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
    minLevel: 7,
    cooldown: 40,
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
    cooldown: 60,
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
          if (!pay(s, c)) {
            trust(s, 2, -1, 0)
            return 'Na dietetyka nie ma pieniędzy, więc szafki przejrzał lekarz z kierownikiem. Znaleźli też dwie kanapki z zeszłego miesiąca.'
          }
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
    cooldown: 20,
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
    cooldown: 60,
    text: 'Dyrektor sportowy przedstawia plan zimowego zgrupowania: dwa tygodnie w Turcji ze sparingami z ukraińskimi i skandynawskimi zespołami albo krajowy ośrodek w górach.',
    options: [
      {
        label: 'Turcja, pełen pakiet',
        apply: ({ s }) => {
          const c = money(s, 900)
          if (!pay(s, c)) {
            trust(s, -2, -2, 0)
            return 'Dyrektor finansowy pokazał stan konta. Turcja odpada, zostają zdjęcia rywali z palmami na Instagramie.'
          }
          mod(s, 'Forma z tureckiego zgrupowania', 1.5, 3)
          coach(s, -4)
          return `Zgrupowanie w Belek (${k(c)}). Boiska jak dywan, sparingi z wymagającymi rywalami, zero śniegu.`
        },
      },
      {
        label: 'Krajowy ośrodek w górach',
        apply: ({ s, rng }) => {
          const c = money(s, 350)
          if (!pay(s, c)) {
            teamMorale(s, -2)
            return 'Nawet na ośrodek w górach nie ma pieniędzy. Drużyna biega po schodach trybuny, co też jest jakimś podejściem.'
          }
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
    cooldown: 60,
    condition: (s) => s.round >= 6 && s.streak.slice(-4).filter((x) => x === 'W').length >= 2,
    text: 'Rada drużyny przynosi pismo: chce zapisania premii za awans w regulaminie, zanim „sprawa się rozstrzygnie”. Prezes uważa, że „premią jest sam awans”.',
    options: [
      {
        label: 'Wywalcz dla nich pełną premię',
        apply: ({ s }) => {
          const c = money(s, 1200)
          if (!pay(s, c)) {
            trust(s, -2, 3, 0)
            teamMorale(s, 3)
            return 'Prezes rozłożył ręce: na pełną premię nie ma pieniędzy. Zapisano „premię uznaniową”, czyli obietnicę.'
          }
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
          if (!pay(s, c)) {
            trust(s, 1, 1, 0)
            return 'Premię za punkty zapisano w regulaminie, wypłata „po sezonie, jak sponsor przeleje”. Zawodnicy podpisali bez entuzjazmu.'
          }
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
    cooldown: 40,
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
    cooldown: 40,
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
          const c = fine(s, money(s, 300))
          trust(s, -8, 0, 9)
          coach(s, 4)
          return c > 0
            ? `Klub płaci karę za transparent (${k(c)}). Kibice skandują Twoje nazwisko, prezes już nie.`
            : 'Kara za transparent trafia do kolejki zaległych płatności. Kibice skandują Twoje nazwisko, prezes już nie.'
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
    minLevel: 8,
    cooldown: 30,
    player: (p) => p.suspendedFor >= 2,
    text: 'Po analizie VAR komisja ligi zawiesiła {p} na kilka meczów. Prawnik klubu uważa, że na powtórce z innej kamery widać, że ledwo musnął rywala.',
    options: [
      {
        label: 'Odwołanie z kancelarią prawną',
        apply: ({ s, p, rng }) => {
          const c = money(s, 300)
          if (!pay(s, c)) {
            trust(s, 0, 1, 0)
            return 'Kancelaria chce zaliczkę, a w kasie pusto. Odwołanie napisał kierownik drużyny. Komisja nawet go nie przeczytała.'
          }
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
          fine(s, money(s, 150))
          scandal(s, 'Krytyka sędziów VAR na konferencji prasowej')
          return 'Kara za wypowiedź przyszła szybciej niż uzasadnienie zawieszenia. Szatnia jest jednak za Tobą.'
        },
      },
    ],
  },
  {
    id: 'akademia_cudowne_dziecko',
    minLevel: 7,
    cooldown: 60,
    player: (p) => p.age <= 19 && (p.traits.includes('talent') || p.potential >= p.skill + 12),
    text: 'Skauci klubu z Portugalii od miesiąca siedzą na meczach juniorów. Teraz oficjalnie zapowiadają ofertę za {p} w najbliższym oknie. Rodzice już oglądają mieszkania w Lizbonie.',
    options: [
      {
        label: 'Umów się na rozmowy w oknie transferowym',
        apply: ({ s, p }) => {
          setMorale(p!, 6)
          trust(s, 3, 0, -3)
          coach(s, 0, 2)
          s.flags[`portugalczycy:${p!.id}`] = s.season
          return '{ps} gra dalej u nas, a w oknie siądziecie do stołu. Akademia już szykuje plakat na ścianę, na wszelki wypadek.'
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
          if (!pay(s, c)) {
            trust(s, -1, 0, 0)
            return 'Dyrektor finansowy zgasił projektor w połowie prezentacji. Na pełny budżet nie ma pieniędzy, analityk wraca do Excela.'
          }
          mod(s, 'Przewaga analityczna', 1, 5)
          coach(s, -2, 2)
          return `Inwestycja: ${k(c)}. Po tygodniu wiesz, że lewy obrońca rywala nie lubi biegać do tyłu.`
        },
      },
      {
        label: 'Tylko kamizelki GPS',
        apply: ({ s }) => {
          const c = money(s, 250)
          if (!pay(s, c)) return 'Nawet na kamizelki nie ma pieniędzy. Sztab mierzy dystans krokomierzem z telefonu.'
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
    cooldown: 30,
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
          fine(s, money(s, 150))
          return 'Zawodnicy wypoczęci, ale trybuny w połowie puste. Wpływy z biletów spadają.'
        },
      },
      {
        label: 'Akcja dla kibiców: darmowy transport i tańsze bilety',
        apply: ({ s }) => {
          const c = money(s, 250)
          if (!pay(s, c)) {
            trust(s, 0, 0, 2)
            return 'Na autobusy i tańsze bilety nie ma pieniędzy. Klub wrzucił za to apel na Facebooka. Przyszło trochę więcej osób niż zwykle.'
          }
          trust(s, 2, 0, 7)
          return `Klub dopłaca do autobusów i biletów (${k(c)}). Stadion pełny, nadawca chwali się ujęciami trybun.`
        },
      },
    ],
  },
  {
    id: 'wlasciciel_rozmowa',
    minLevel: 6,
    cooldown: 20,
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
    cooldown: 30,
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

  // ---------- nowe: piłka amatorska (C-klasa – klasa okręgowa) ----------
  {
    id: 'soltys_dozynki',
    maxLevel: 3,
    cooldown: 60,
    text: 'Sołtys prosi, żeby drużyna zagrała na dożynkach mecz „kawalerowie kontra żonaci”. W niedzielę rano, dzień po meczu ligowym.',
    options: [
      {
        label: 'Cała drużyna gra',
        apply: ({ s, rng }) => {
          trust(s, 2, 2, 7)
          teamMorale(s, 5)
          if (rng.chance(0.25)) {
            const p = rng.pick(s.squad)
            p.injuredFor = Math.max(p.injuredFor, 1)
            return `Kawalerowie wygrali 7:6, a ${p.firstName[0]}. ${p.lastName} skręcił kostkę na kretowisku. Sołtys obiecał, że w przyszłym roku zasypie dziury.`
          }
          return 'Kawalerowie wygrali 7:6 po dogrywce. Wieś zachwycona, a na kolację był bigos z kotła.'
        },
      },
      {
        label: 'Wyślij tylko rezerwowych',
        apply: ({ s }) => {
          trust(s, 1, 1, 3)
          s.squad.filter((p) => p.benchStreak >= 1).forEach((p) => setMorale(p, 5))
          return 'Rezerwowi wreszcie zagrali całe 90 minut. Jeden zapytał, czy dożynki mogą być co tydzień.'
        },
      },
      {
        label: 'Odmów, zawodnicy muszą odpocząć',
        apply: ({ s }) => {
          trust(s, -3, 1, -4)
          return 'Sołtys przyjął odmowę z kamienną twarzą. W ogłoszeniach gminnych zespół podpisano jako „nasi niedzielni wypoczywający”.'
        },
      },
    ],
  },
  {
    id: 'krowy_na_boisku',
    maxLevel: 2,
    cooldown: 40,
    text: 'Godzinę przed meczem na boisko weszły krowy sąsiada. Pasą się w polu karnym i nie wyglądają, jakby się gdzieś spieszyły.',
    options: [
      {
        label: 'Zawodnicy przeganiają krowy',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            mod(s, 'Rozgrzewka z krowami', 0.5, 1)
            return 'Najlepsza rozgrzewka w sezonie: sprinty, zwody i zmiany kierunku. Krowy wróciły do obory obrażone.'
          }
          mod(s, 'Pole karne po krowach', -0.5, 1)
          return 'Krowy zeszły, ale zostawiły po sobie pamiątki. Bramkarz do przerwy nie rzucał się na ziemię.'
        },
      },
      {
        label: 'Zadzwoń do gospodarza',
        apply: ({ s }) => {
          trust(s, 1, 0, 2)
          coach(s, 3)
          return 'Gospodarz przyszedł po 40 minutach, z kawą. Mecz zaczął się z opóźnieniem, a sędzia dostał od niego jajka.'
        },
      },
      {
        label: 'Uznaj to za darmowe koszenie trawy',
        apply: ({ s }) => {
          trust(s, -1, 2, 3)
          return 'Trawa przycięta równiej niż kosiarką. Rywale podejrzewają, że to element taktyki.'
        },
      },
    ],
  },
  {
    id: 'kosiarka_zepsuta',
    maxLevel: 3,
    cooldown: 60,
    text: 'Klubowa kosiarka wydała ostatnie tchnienie. Trawa sięga za kostki, a w sobotę mecz u siebie.',
    options: [
      {
        label: 'Kup nową z budżetu',
        apply: ({ s }) => {
          const c = money(s, 350)
          if (!pay(s, c)) {
            trust(s, 0, 0, 1)
            return 'Na nową kosiarkę nie ma pieniędzy. Prezes przywiózł z domu swoją, elektryczną, z przedłużaczem na 60 metrów.'
          }
          mod(s, 'Równo skoszone', 0.5, 2)
          return `Nowa kosiarka (${k(c)}) pracuje jak marzenie. Kierownik drużyny kosi boisko w paski, jak na Wembley.`
        },
      },
      {
        label: 'Pożycz od sąsiada z gospodarstwa',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            trust(s, 1, 0, 3)
            return 'Sąsiad przyjechał traktorem z kosiarką rotacyjną. Boisko gotowe w kwadrans, a środkowe koło trochę przesunięte.'
          }
          mod(s, 'Boisko w pasy', -0.5, 1)
          return 'Sąsiad skosił pół boiska i pojechał na obiad. Drugą połowę rozgrywacie w łące.'
        },
      },
      {
        label: 'Gramy w wysokiej trawie',
        apply: ({ s }) => {
          s.tactic.style = 'laga'
          mod(s, 'Łąka u siebie', 1, 1)
          return 'Po trawie piłka nie toczy się wcale, więc gracie górą. Rywale szukają piłki jak grzybów.'
        },
      },
    ],
  },
  {
    id: 'zniwa',
    maxLevel: 3,
    cooldown: 60,
    text: 'Zaczęły się żniwa. Połowa składu siedzi na kombajnach i pyta, czy trening może być „po zmroku, jak zejdzie rosa”.',
    options: [
      {
        label: 'Przesuń trening na 21:00',
        apply: ({ s }) => {
          coach(s, 5)
          trust(s, 0, 4, 0)
          return 'Trening przy reflektorach traktora. Frekwencja pełna, choć dwóch zawodników zasnęło w trakcie rozciągania.'
        },
      },
      {
        label: 'Zwolnij ich z treningów na tydzień',
        apply: ({ s }) => {
          trust(s, 0, 5, 2)
          mod(s, 'Drużyna w polu', -1, 1)
          return 'Zawodnicy wdzięczni, zboże zebrane. Kondycję mają jak woły, tylko z piłką gorzej.'
        },
      },
      {
        label: 'Pomóż im w polu, potem trening',
        apply: ({ s }) => {
          coach(s, 8, 1)
          trust(s, 1, 6, 5)
          teamMorale(s, 4)
          return 'Trener na przyczepie z ziarnem: zdjęcie obiegło gminę. Po żniwach drużyna pójdzie za Tobą w ogień.'
        },
      },
    ],
  },
  {
    id: 'proboszcz_ogloszenia',
    maxLevel: 3,
    cooldown: 60,
    text: 'Proboszcz chce zapowiedzieć mecz w ogłoszeniach parafialnych. Ma jedną prośbę: żeby zaczynać o 15:00, a nie w trakcie sumy.',
    options: [
      {
        label: 'Przesuń godzinę meczu',
        apply: ({ s }) => {
          trust(s, 3, 0, 5)
          return 'Po ogłoszeniach na mecz przyszło pół parafii. Taca przy bramie wyjściowej też była, ale to już inicjatywa kościelnego.'
        },
      },
      {
        label: 'Terminarz to terminarz',
        apply: ({ s }) => {
          trust(s, 0, 0, -4)
          return 'Proboszcz zapowiedział mecz, ale bez entuzjazmu. Frekwencja jak zwykle, czyli rodziny zawodników i dwa psy.'
        },
      },
    ],
  },
  {
    id: 'zmiana_w_pracy',
    maxLevel: 4,
    cooldown: 12,
    player: (p) => p.apps >= 1 && p.injuredFor === 0 && p.suspendedFor === 0,
    text: '{p} dzwoni w piątek wieczorem: szef wpisał mu zmianę na sobotę i „nie ma dyskusji”.',
    options: [
      {
        label: 'Zadzwoń do jego szefa',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.55)) {
            setMorale(p!, 8)
            trust(s, 0, 2, 0)
            return 'Szef okazał się kibicem. Zgodził się pod warunkiem, że dostanie dwa miejsca przy ławce. {ps} zagra.'
          }
          coach(s, 3)
          mod(s, 'Brak zawodnika z pracy', -0.5, 1)
          return 'Szef nie jest kibicem. Jest kibicem rywala. {ps} spędzi sobotę na magazynie.'
        },
      },
      {
        label: 'Niech zamieni się z kolegą z pracy',
        apply: ({ p, rng }) => {
          if (rng.chance(0.65)) {
            setMorale(p!, 4)
            return '{ps} zamienił się z kolegą za dwa nocne dyżury i słoik ogórków. Zagra.'
          }
          setMorale(p!, -5)
          return 'Nikt nie chciał się zamienić. {ps} obiecuje, że „dojedzie na drugą połowę”.'
        },
      },
      {
        label: 'Praca ważniejsza, gramy bez niego',
        apply: ({ s, p }) => {
          setMorale(p!, 3)
          trust(s, 0, 2, 0)
          mod(s, 'Brak zawodnika z pracy', -0.5, 1)
          return '{ps} dziękuje za zrozumienie. Na boisku zagra ktoś inny, a szatnia docenia ludzkie podejście.'
        },
      },
    ],
  },
  {
    id: 'osp_woz',
    maxLevel: 3,
    cooldown: 60,
    text: 'Susza, boisko twarde jak beton. Ochotnicza straż pożarna proponuje, że podleje murawę wozem bojowym. W zamian chce meczu towarzyskiego z drużyną.',
    options: [
      {
        label: 'Bierzemy wodę i gramy ze strażakami',
        apply: ({ s, rng }) => {
          mod(s, 'Podlana murawa', 0.5, 2)
          trust(s, 1, 2, 5)
          if (rng.chance(0.3)) {
            teamMorale(s, -3)
            return 'Murawa podlana, ale strażacy wygrali towarzyski 3:1. Szatnia ma tydzień złego humoru, a strażacy nowe zdjęcie na tablicy.'
          }
          teamMorale(s, 3)
          return 'Murawa podlana, strażacy pokonani 4:2, a potem wspólna kiełbasa przy remizie. Wszyscy zadowoleni.'
        },
      },
      {
        label: 'Podziękuj, poczekamy na deszcz',
        apply: ({ s }) => {
          mod(s, 'Boisko jak beton', -0.5, 1)
          trust(s, 0, 0, -2)
          return 'Deszcz nie przyszedł. Piłka odbija się od murawy jak od parkietu, a strażacy już nie pytają.'
        },
      },
    ],
  },
  {
    id: 'bufet_zapiekanki',
    maxLevel: 4,
    once: true,
    text: 'Pani Krysia otwiera pod trybuną budkę z zapiekankami. Proponuje, że zostanie sponsorem klubu, jeśli zawodnicy będą u niej jeść po meczach.',
    options: [
      {
        label: 'Umowa z panią Krysią',
        apply: ({ s }) => {
          const c = money(s, 300)
          s.budget += c
          teamMorale(s, 5)
          mod(s, 'Zapiekankowa dieta', -0.5, 2)
          return `Pani Krysia dorzuca ${k(c)} i zapiekanki po meczach. Morale w górę, dietetyk (gdyby był) by płakał.`
        },
      },
      {
        label: 'Sponsoring tak, zapiekanki nie',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            s.budget += money(s, 150)
            return 'Pani Krysia przystała na mniejszą umowę. Zawodnicy i tak przychodzą do budki, tylko ukradkiem.'
          }
          trust(s, 0, -2, -1)
          return 'Pani Krysia obraziła się i w budce wisi kartka: „Trenerowi nie sprzedajemy”.'
        },
      },
      {
        label: 'Odmów, klub dba o formę',
        apply: ({ s }) => {
          trust(s, 1, -3, -2)
          return 'Pani Krysia handluje dalej, ale już bez logo klubu. Kibice kupują, zawodnicy patrzą z zazdrością.'
        },
      },
    ],
  },
  {
    id: 'sedzia_nie_dojechal',
    maxLevel: 4,
    cooldown: 40,
    text: 'Sędzia nie dojechał na mecz, telefon ma wyłączony. Kierownik rywali proponuje, żeby sędziował „pan Zenek z trybuny, kiedyś miał uprawnienia”.',
    options: [
      {
        label: 'Zgódź się na pana Zenka',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            mod(s, 'Sędzia z trybuny', -1, 1)
            coach(s, 4)
            return 'Pan Zenek okazał się wujkiem bramkarza rywali. Podyktował im dwa karne, w tym jeden za aut.'
          }
          trust(s, 0, 1, 2)
          return 'Pan Zenek sędziował lepiej niż połowa obsady z okręgu. Gwiżdże z pamięci przepisy z 1985 roku, ale sprawiedliwie.'
        },
      },
      {
        label: 'Niech sędziuje ktoś z naszego klubu',
        apply: ({ s, rng }) => {
          mod(s, 'Swój sędzia', 1, 1)
          if (rng.chance(0.35)) {
            scandal(s, 'Mecz sędziowany przez kierownika gospodarzy')
            trust(s, -4, 2, 0)
            return 'Wygrana smakuje, ale rywale złożyli protest. Okręgowy związek przegląda nagranie z telefonu.'
          }
          trust(s, 0, 2, 1)
          return 'Kierownik drużyny sędziował w klubowym dresie. Rywale narzekali, ale protestu nie złożyli.'
        },
      },
      {
        label: 'Żądaj przełożenia meczu',
        apply: ({ s }) => {
          trust(s, -2, -1, -2)
          coach(s, 3)
          return 'Mecz przełożony. Trzydziestu kibiców wraca do domu, a kiełbasy z grilla trzeba było zjeść w szatni.'
        },
      },
    ],
  },
  {
    id: 'bojler_szatnia',
    maxLevel: 3,
    cooldown: 60,
    text: 'W szatni padł bojler. Po treningu są tylko lodowate prysznice, a w październiku to nie jest atrakcja.',
    options: [
      {
        label: 'Nowy bojler z budżetu',
        apply: ({ s }) => {
          const c = money(s, 250)
          if (!pay(s, c)) {
            teamMorale(s, -3)
            return 'Na nowy bojler nie ma pieniędzy. Prezes przyniósł czajnik elektryczny i powiedział: „radźcie sobie”.'
          }
          trust(s, 0, 3, 0)
          return `Nowy bojler (${k(c)}) grzeje jak szalony. Zawodnicy zostają po treningu dłużej, głównie pod prysznicem.`
        },
      },
      {
        label: 'Hartujemy się jak morsy',
        apply: ({ s, rng }) => {
          teamMorale(s, -5)
          if (rng.chance(0.3)) {
            const p = rng.pick(s.squad)
            p.injuredFor = Math.max(p.injuredFor, 1)
            return `Hartowanie przetrwali wszyscy oprócz ${p.firstName[0]}. ${p.lastName}, który leży z gorączką. Mecz przerwy.`
          }
          mod(s, 'Hartowanie', 0.5, 2)
          return 'Szatnia pomstuje, ale nikt nie choruje. Kapitan zapowiada, że w zimie idzie do przerębla.'
        },
      },
    ],
  },
  {
    id: 'babcia_na_trybunie',
    maxLevel: 4,
    cooldown: 60,
    player: (p) => p.age <= 24,
    text: 'Babcia {p} przychodzi na każdy mecz i przez 90 minut krzyczy na trenera, że „wnuczek powinien grać w ataku”.',
    options: [
      {
        label: 'Zaproś babcię na kawę do klubu',
        apply: ({ s, p }) => {
          trust(s, 0, 1, 4)
          setMorale(p!, 6)
          return 'Babcia przyniosła sernik i wykład z taktyki. Od teraz krzyczy na sędziego, nie na trenera.'
        },
      },
      {
        label: 'Daj wnuczkowi zagrać w ataku',
        apply: ({ p, rng }) => {
          setMorale(p!, 10)
          if (rng.chance(0.4)) {
            nudgeForm(p!, 1)
            return '{ps} strzelił gola po wejściu do ataku. Babcia cała w łzach, Ty też trochę.'
          }
          nudgeForm(p!, -1)
          return '{ps} w ataku czuje się jak ryba na pustyni. Babcia twierdzi, że to wina podań.'
        },
      },
      {
        label: 'Udawaj, że nie słyszysz',
        apply: ({ s }) => {
          coach(s, 3)
          return 'Udajesz, ale babcia ma donośny głos. Cała trybuna zna już jej zdanie o Twojej taktyce.'
        },
      },
    ],
  },
  {
    id: 'pies_maskotka',
    maxLevel: 4,
    once: true,
    text: 'Na każdy trening przychodzi bezpański kundel. Aportuje piłki zza bramki i ma lepszy refleks niż rezerwowy bramkarz. Zawodnicy chcą go zatrzymać.',
    options: [
      {
        label: 'Adoptuj go jako maskotkę',
        apply: ({ s }) => {
          teamMorale(s, 6)
          trust(s, 0, 4, 5)
          s.flags.pies = s.season
          return 'Pies dostał imię „Ofsajd” i własną miskę z herbem. Na mecze przychodzą dzieci, żeby go pogłaskać.'
        },
      },
      {
        label: 'Znajdź mu dom u kibica',
        apply: ({ s }) => {
          trust(s, 0, 1, 3)
          return 'Pies zamieszkał u kibica, ale i tak przychodzi na każdy trening. Teraz z obrożą i z właścicielem.'
        },
      },
      {
        label: 'Boisko to nie schronisko',
        apply: ({ s }) => {
          teamMorale(s, -4)
          trust(s, 0, -2, -3)
          return 'Pies zniknął. Bramkarz rezerwowy jako jedyny odetchnął z ulgą, reszta drużyny długo Ci tego nie wybaczy.'
        },
      },
    ],
  },
  {
    id: 'emeryt_trener_bramkarzy',
    minLevel: 1,
    maxLevel: 4,
    once: true,
    text: 'Pan Tadeusz, legendarny bramkarz miejscowej drużyny z lat 80., oferuje, że za darmo będzie trenował bramkarzy. Chce tylko kawę i miejsce parkingowe pod bramą.',
    options: [
      {
        label: 'Przyjmij go z otwartymi rękami',
        apply: ({ s }) => {
          s.squad.filter((p) => p.pos === 'BR').forEach((p) => {
            p.progress += 0.5
            setMorale(p, 5)
          })
          trust(s, 0, 2, 3)
          return 'Pan Tadeusz każe bramkarzom rzucać się na żwir „jak za jego czasów”. Narzekają, ale łapią coraz więcej.'
        },
      },
      {
        label: 'Grzecznie odmów',
        apply: ({ s }) => {
          trust(s, 0, 0, -3)
          return 'Pan Tadeusz odjechał bez słowa. W sklepie u pani Basi już wiedzą, że „nowy trener nie szanuje legend”.'
        },
      },
    ],
  },
  {
    id: 'festyn_disco',
    maxLevel: 4,
    cooldown: 60,
    text: 'Gmina wynajęła boisko na festyn z zespołem disco polo. W sobotę wieczorem, dzień przed meczem. Scena stanie na środku murawy.',
    options: [
      {
        label: 'Protestuj u wójta',
        apply: ({ s, rng }) => {
          coach(s, 4)
          if (rng.chance(0.4)) {
            trust(s, 2, 2, 0)
            return 'Wójt przeniósł scenę na parking. Murawa ocalała, a zespół i tak było słychać w trzech wioskach.'
          }
          trust(s, -3, 0, 0)
          mod(s, 'Murawa po festynie', -1, 1)
          return 'Wójt stwierdził, że „ludzie też muszą mieć rozrywkę”. W niedzielę gracie między śladami po scenie.'
        },
      },
      {
        label: 'Klub prowadzi parking i zarabia',
        apply: ({ s }) => {
          const c = money(s, 200)
          s.budget += c
          coach(s, 5)
          mod(s, 'Niewyspani po festynie', -0.5, 1)
          return `Zawodnicy kierowali ruchem do północy, klub zarobił ${k(c)}. Do rana w głowie dudni refren.`
        },
      },
      {
        label: 'Cała drużyna idzie potańczyć',
        apply: ({ s }) => {
          teamMorale(s, 8)
          trust(s, -2, 5, 3)
          mod(s, 'Taneczny kac', -1, 1)
          return 'Napastnik wygrał konkurs tańca, kapitan konkurs karaoke. W niedzielę nogi jak z ołowiu.'
        },
      },
    ],
  },
  {
    id: 'wieczor_kawalerski',
    maxLevel: 4,
    once: true,
    player: (p) => p.age >= 22 && p.injuredFor === 0,
    text: '{p} bierze ślub i zaprasza całą drużynę na wieczór kawalerski. W piątek, dzień przed meczem.',
    options: [
      {
        label: 'Zakaz, przenieście na niedzielę',
        apply: ({ s, p }) => {
          setMorale(p!, -8)
          trust(s, 2, -2, 0)
          return 'Wieczór kawalerski przeniesiony. {ps} nadąsany, ale świadek przyznał, że w niedzielę i tak taniej.'
        },
      },
      {
        label: 'Idźcie, ale do 22:00',
        apply: ({ s, p, rng }) => {
          setMorale(p!, 6)
          if (rng.chance(0.4)) {
            mod(s, 'Kac po kawalerskim', -1, 1)
            return 'O 22:00 wszyscy wyszli. Z jednego lokalu do drugiego. Na rozgrzewce kilku zawodników mrużyło oczy od słońca.'
          }
          teamMorale(s, 4)
          return 'Drużyna wróciła o 22:05, z przeprosinami za pięć minut spóźnienia. Wzorowa integracja.'
        },
      },
      {
        label: 'Idź z nimi i pilnuj porządku',
        apply: ({ s, p }) => {
          setMorale(p!, 10)
          teamMorale(s, 5)
          trust(s, 0, 5, 0)
          coach(s, 4)
          return 'Trener na wieczorze kawalerskim to nowy poziom kontroli. Wszyscy w domu przed północą, a {ps} zaprasza Cię na wesele.'
        },
      },
    ],
  },
  {
    id: 'kolega_z_podworka',
    maxLevel: 3,
    once: true,
    text: 'Twój kolega z podstawówki, 41 lat, „kiedyś najlepszy na osiedlu”, pyta, czy może trenować z drużyną. Twierdzi, że „nogi pamiętają”.',
    options: [
      {
        label: 'Niech potrenuje',
        apply: ({ s, rng }) => {
          teamMorale(s, 4)
          if (rng.chance(0.5)) {
            trust(s, 0, 3, 0)
            return 'Nogi pamiętają, płuca już nie. Ale jego opowieści z boiska przy trzepaku szatnia uwielbia.'
          }
          return 'Kolega zszedł po 20 minutach, ale zdążył założyć siatkę kapitanowi. Kapitan nie śpi od tamtej pory.'
        },
      },
      {
        label: 'Przyjaźń przyjaźnią, drużyna drużyną',
        apply: ({ s }) => {
          coach(s, 2)
          return 'Kolega zrozumiał. Na grillu u wspólnych znajomych i tak będzie opowiadał, że „trener się go bał”.'
        },
      },
    ],
  },
  {
    id: 'kolo_gospodyn_pierogi',
    maxLevel: 3,
    cooldown: 60,
    text: 'Koło Gospodyń Wiejskich proponuje, że przed każdym meczem domowym przygotuje dla drużyny pierogi. Ruskie, z mięsem i z jagodami.',
    options: [
      {
        label: 'Pierogi przed meczem',
        apply: ({ s }) => {
          teamMorale(s, 6)
          mod(s, 'Ciężkie nogi po pierogach', -1, 1)
          trust(s, 0, 3, 4)
          return 'Pierogi wybitne. Pierwsza połowa trochę gorzej, bo zawodnicy biegali jak po wigilii.'
        },
      },
      {
        label: 'Pierogi po meczu',
        apply: ({ s }) => {
          teamMorale(s, 5)
          trust(s, 0, 2, 4)
          return 'Pierogi po meczu stały się świętem. Po zwycięstwach z jagodami, po porażkach tylko ruskie.'
        },
      },
      {
        label: 'Podziękuj, mamy dietę',
        apply: ({ s }) => {
          trust(s, 0, -3, -4)
          return 'Panie z koła przyjęły to chłodno. Na najbliższym meczu jedynym dopingiem było „Dieta, dieta!” z trybun.'
        },
      },
    ],
  },

  // ---------- nowe: IV i III liga ----------
  {
    id: 'komisja_licencyjna',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 60,
    text: 'Komisja licencyjna przysyła pismo: na trybunie brakuje 120 krzesełek z oparciem, a oświetlenie „nie spełnia wymogów w zakresie natężenia”.',
    options: [
      {
        label: 'Dokup krzesełka z budżetu',
        apply: ({ s }) => {
          const c = money(s, 250)
          if (!pay(s, c)) {
            trust(s, -3, 0, 0)
            coach(s, 3)
            return 'Na krzesełka nie ma pieniędzy. Prezes pisze do komisji odwołanie, w którym cytuje regulamin z 1998 roku.'
          }
          trust(s, 3, 0, 2)
          return `Krzesełka zamontowane (${k(c)}). Kibice od lat siedzący na murku mówią, że „to już nie to samo”.`
        },
      },
      {
        label: 'Poproś o pomoc burmistrza',
        apply: ({ s, rng }) => {
          coach(s, 3)
          if (rng.chance(0.55)) {
            trust(s, 4, 0, 1)
            return 'Burmistrz przysłał ekipę z zakładu komunalnego. Krzesełka są, a na nowej tablicy widnieje jego nazwisko.'
          }
          trust(s, -2, 0, 0)
          return 'Burmistrz obiecał „pochylić się nad tematem”. Pochyla się już trzeci tydzień.'
        },
      },
      {
        label: 'Zignoruj pismo',
        apply: ({ s }) => {
          trust(s, -5, 0, 0)
          return 'Pismo trafiło do szuflady. Prezes zapytał, czy trener w ogóle wie, że licencje istnieją.'
        },
      },
    ],
  },
  {
    id: 'urlop_na_mecz',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 25,
    text: 'Środowy mecz o 17:00. Trzech zawodników nie dostało urlopu w pracy, a czwarty ma tego dnia egzamin na prawo jazdy.',
    options: [
      {
        label: 'Klub dopłaca im do dnia urlopu',
        apply: ({ s }) => {
          const c = money(s, 60)
          if (!pay(s, c)) {
            mod(s, 'Środowy skład awaryjny', -1, 1)
            return 'Na dopłaty nie ma pieniędzy. W środę gracie z juniorami i kierownikiem drużyny na ławce.'
          }
          trust(s, -1, 4, 0)
          return `Klub wyrównuje im stracone dniówki (${k(c)}). Egzaminu na prawo jazdy nie da się przełożyć, ale reszta zagra.`
        },
      },
      {
        label: 'Napisz pisma do pracodawców',
        apply: ({ s, rng }) => {
          coach(s, 3)
          if (rng.chance(0.5)) {
            trust(s, 0, 3, 0)
            return 'Dwóch szefów zgodziło się po piśmie z pieczątką klubu. Jeden poprosił o autograf, choć nie wiadomo czyj.'
          }
          mod(s, 'Środowy skład awaryjny', -1, 1)
          return 'Pisma nic nie dały. „Piłka to hobby” – odpisał jeden z pracodawców. Trudno się kłócić.'
        },
      },
      {
        label: 'Szansa dla rezerwowych',
        apply: ({ s }) => {
          s.squad.filter((p) => p.benchStreak >= 2).forEach((p) => setMorale(p, 8))
          mod(s, 'Środowy skład awaryjny', -0.5, 1)
          return 'Rezerwowi dostają swój mecz. Grają, jakby od tego zależało ich życie, bo trochę zależy.'
        },
      },
    ],
  },
  {
    id: 'kablowka_transmisja',
    minLevel: 5,
    maxLevel: 6,
    once: true,
    text: 'Lokalna telewizja kablowa chce transmitować wasze mecze domowe. Komentator to emerytowany nauczyciel geografii, który nie zna nazwisk zawodników.',
    options: [
      {
        label: 'Zgoda, każda reklama się liczy',
        apply: ({ s }) => {
          const c = money(s, 120)
          s.budget += c
          trust(s, 2, 0, 4)
          return `Telewizja płaci ${k(c)} za sezon. Komentator nazywa zawodników po kolorze butów, ale kibice to pokochali.`
        },
      },
      {
        label: 'Zgoda, ale daj im listę nazwisk',
        apply: ({ s }) => {
          trust(s, 1, 3, 3)
          teamMorale(s, 3)
          return 'Komentator wkuł nazwiska na pamięć. Zawodnicy oglądają powtórki z rodziną i nagle bardziej się starają.'
        },
      },
      {
        label: 'Odmów, nie chcemy kamer',
        apply: ({ s }) => {
          trust(s, -2, 0, -2)
          return 'Telewizja transmituje mecze rywala. W lokalnych wiadomościach o waszym klubie mówią tylko przy okazji wypadków.'
        },
      },
    ],
  },
  {
    id: 'mecz_podwyzszonego_ryzyka',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 40,
    text: 'Policja uznała najbliższy mecz u siebie za mecz podwyższonego ryzyka. Klub musi zapewnić licencjonowaną ochronę albo zamknąć sektor gości.',
    options: [
      {
        label: 'Wynajmij agencję ochrony',
        apply: ({ s }) => {
          const c = money(s, 150)
          if (!pay(s, c)) {
            trust(s, -1, 0, -3)
            return 'Na agencję ochrony nie ma pieniędzy, więc sektor gości zamknięty. Kibice rywali oglądają mecz z dachu pobliskiego garażu.'
          }
          trust(s, 2, 0, 2)
          return `Ochrona kosztuje ${k(c)}. Mecz przebiega spokojnie, a ochroniarze najgłośniej dopingują w drugiej połowie.`
        },
      },
      {
        label: 'Zamknij sektor gości',
        apply: ({ s }) => {
          trust(s, 1, 0, -3)
          mod(s, 'Cisza na trybunach', -0.5, 1)
          return 'Mecz w kameralnej atmosferze. Nikt nie wie, czy to dobrze, czy źle, bo nikt nie krzyczy.'
        },
      },
    ],
  },
  {
    id: 'sesja_na_studiach',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 40,
    player: (p) => p.age <= 24,
    text: '{p} ma sesję na studiach i prosi o zwolnienie z dwóch treningów. Twierdzi, że egzamin z mikroekonomii jest trudniejszy niż obrona przed kontrą.',
    options: [
      {
        label: 'Zgoda, nauka najważniejsza',
        apply: ({ s, p }) => {
          setMorale(p!, 10)
          trust(s, 0, 2, 0)
          nudgeForm(p!, -1)
          return '{ps} zdał egzamin na czwórkę. Na boisku po dwóch dniach przerwy myli prawą stronę z lewą, ale to minie.'
        },
      },
      {
        label: 'Niech uczy się w autokarze',
        apply: ({ p, rng }) => {
          if (rng.chance(0.5)) {
            setMorale(p!, 4)
            return '{ps} uczył się w autokarze na wyjazd. Zdał, a połowa drużyny wie teraz, czym jest elastyczność popytu.'
          }
          setMorale(p!, -8)
          return '{ps} oblał. Wini kolegów z tylnych siedzeń, którzy przez całą drogę śpiewali.'
        },
      },
      {
        label: 'Treningi są obowiązkowe',
        apply: ({ s, p }) => {
          setMorale(p!, -10)
          trust(s, 2, -2, 0)
          p!.progress += 0.2
          return '{ps} trenuje z notatkami w kieszeni spodenek. Na rozciąganiu powtarza wzory.'
        },
      },
    ],
  },
  {
    id: 'sponsor_tytularny_hurtownia',
    minLevel: 5,
    maxLevel: 6,
    once: true,
    text: 'Lokalna hurtownia materiałów budowlanych chce zostać sponsorem tytularnym. W nazwie klubu pojawiłoby się słowo „Cegłobud”.',
    options: [
      {
        label: 'Bierzemy, pieniądze nie śmierdzą',
        apply: ({ s }) => {
          s.budget += money(s, 500)
          s.wageLimit = Math.round(s.wageLimit * 1.04)
          trust(s, 5, 0, -5)
          return 'Na tablicy wyników „{klub} Cegłobud”. Kibice ze starszego pokolenia piszą protesty, ale limit pensji rośnie.'
        },
      },
      {
        label: 'Tylko logo na koszulkach',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            s.budget += money(s, 250)
            trust(s, 2, 0, 1)
            return 'Hurtownia zgodziła się na logo. Cegła na plecach zawodników wygląda zaskakująco dobrze.'
          }
          trust(s, -2, 0, 0)
          return 'Hurtownia poszła do klubu koszykówki. Teraz to oni mają cegłę w nazwie.'
        },
      },
      {
        label: 'Nazwa klubu nie jest na sprzedaż',
        apply: ({ s }) => {
          trust(s, -4, 0, 6)
          return 'Kibice wywiesili transparent „Nazwa z historią, nie z hurtowni”. Prezes powiesił obok fakturę za prąd.'
        },
      },
    ],
  },
  {
    id: 'wyjazd_o_swicie',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 20,
    text: 'Najbliższy wyjazd to 300 kilometrów. Prezes proponuje wyjazd w dniu meczu o 5:00 rano, żeby „nie przepalać pieniędzy na hotel”.',
    options: [
      {
        label: 'Nocleg dzień wcześniej',
        apply: ({ s }) => {
          const c = money(s, 150)
          if (!pay(s, c)) {
            mod(s, 'Pobudka o czwartej', -1, 1)
            return 'Na hotel nie ma pieniędzy. Wyjazd o 5:00, kawa z termosu i drzemka na stacji benzynowej.'
          }
          mod(s, 'Wyspani na wyjeździe', 0.5, 1)
          return `Hotel przy obwodnicy (${k(c)}). Wszyscy wyspani, choć bramkarz narzeka na twardą poduszkę.`
        },
      },
      {
        label: 'Jedziemy o świcie',
        apply: ({ s }) => {
          mod(s, 'Pobudka o czwartej', -1, 1)
          trust(s, 2, -2, 0)
          return 'W autokarze śpią wszyscy, łącznie z kierowcą na postojach. Pierwsza połowa wygląda jak dalszy ciąg snu.'
        },
      },
      {
        label: 'Przekonaj sponsora do dopłaty',
        apply: ({ s, rng }) => {
          coach(s, 2)
          if (rng.chance(0.5)) {
            mod(s, 'Wyspani na wyjeździe', 0.5, 1)
            trust(s, 1, 2, 0)
            return 'Sponsor dopłacił do hotelu w zamian za zdjęcie drużyny z jego banerem. Wszyscy zadowoleni.'
          }
          mod(s, 'Pobudka o czwartej', -1, 1)
          return 'Sponsor ma w tym miesiącu „trudniejszy okres”. Wyjazd o 5:00.'
        },
      },
    ],
  },
  {
    id: 'trener_rywala_gazeta',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 40,
    text: 'Trener najbliższego rywala w lokalnym tygodniku: „{klub} gra jak drużyna oldbojów, tylko wolniej”.',
    options: [
      {
        label: 'Odpowiedz ostro w mediach',
        apply: ({ s }) => {
          trust(s, 0, 3, 5)
          mod(s, 'Sportowa złość', 1, 1)
          coach(s, 4)
          return '„Przynajmniej oldboje wiedzą, gdzie jest bramka” – odpisałeś. Tygodnik dodrukował nakład.'
        },
      },
      {
        label: 'Powieś artykuł w szatni i milcz',
        apply: ({ s }) => {
          teamMorale(s, 5)
          mod(s, 'Sportowa złość', 1, 1)
          return 'Wycinek wisi na drzwiach szatni. Każdy zawodnik czyta go przed wyjściem na rozgrzewkę.'
        },
      },
      {
        label: 'Zaproś go na kawę po meczu',
        apply: ({ s }) => {
          coach(s, -2, 1)
          trust(s, 1, 0, -1)
          return 'Po meczu kawa i rozmowa o czasach, gdy obaj graliście w okręgówce. Okazuje się, że nawet go lubisz.'
        },
      },
    ],
  },
  {
    id: 'mroz_trening',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 40,
    text: 'Mróz minus 12, boisko zamarznięte na kość, a w weekend mecz. Trzeba gdzieś trenować.',
    options: [
      {
        label: 'Wynajmij boisko ze sztuczną murawą',
        apply: ({ s }) => {
          const c = money(s, 80)
          if (!pay(s, c)) {
            mod(s, 'Zima w sali gimnastycznej', -0.5, 2)
            return 'Na wynajem sztucznej murawy nie ma pieniędzy. Trening w szkolnej sali, między drabinkami a kozłem.'
          }
          mod(s, 'Trening na sztucznej', 0.5, 2)
          return `Wynajęte boisko (${k(c)}) jest podgrzewane. Zawodnicy nie chcą schodzić po treningu.`
        },
      },
      {
        label: 'Sala gimnastyczna w szkole',
        apply: ({ s }) => {
          mod(s, 'Zima w sali gimnastycznej', -0.5, 2)
          trust(s, 1, -1, 0)
          return 'Gra w zbijaka, krótkie podania i dwa zbite okna. Dyrektor szkoły prosi o pokrycie szkód „w ramach sponsoringu”.'
        },
      },
      {
        label: 'Biegi w lesie po śniegu',
        apply: ({ s }) => {
          s.squad.forEach((p) => (p.progress += 0.05))
          teamMorale(s, -4)
          mod(s, 'Zimowa kondycja', 0.5, 2)
          return 'Kondycja rośnie, humory spadają. Jeden zawodnik twierdzi, że widział wilka. Inni, że to był kierownik.'
        },
      },
    ],
  },
  {
    id: 'kibice_autokar',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 40,
    text: 'Kibice proszą klub o dopłatę do autokaru na ważny mecz wyjazdowy. Chętnych jest czterdziestu, kasy w kibicowskiej zrzutce na dwudziestu.',
    options: [
      {
        label: 'Klub dopłaca',
        apply: ({ s }) => {
          const c = money(s, 40)
          if (!pay(s, c)) {
            trust(s, 0, 0, -2)
            return 'Klub nie ma na dopłatę. Kibice jadą pociągiem z trzema przesiadkami i docierają na drugą połowę.'
          }
          trust(s, -1, 0, 6)
          mod(s, 'Doping na wyjeździe', 0.5, 1)
          return `Klub dopłaca ${k(c)}. Na wyjeździe słychać tylko waszych kibiców, gospodarze wyglądają na zaskoczonych.`
        },
      },
      {
        label: 'Dołóż z własnej kieszeni',
        apply: ({ s }) => {
          const c = money(s, 20)
          if (!paySelf(s, c)) {
            trust(s, 0, 0, 1)
            return 'Zajrzałeś do portfela i wyszło, że stać Cię głównie na dobre słowo. Kibice docenili chęci.'
          }
          trust(s, 0, 1, 8)
          coach(s, 0, 1)
          mod(s, 'Doping na wyjeździe', 0.5, 1)
          return `Trener dorzuca ${k(c)} z prywatnych oszczędności. Kibice szyją transparent z Twoim nazwiskiem.`
        },
      },
      {
        label: 'Odmów, klub nie jest biurem podróży',
        apply: ({ s }) => {
          trust(s, 1, 0, -5)
          return 'Na wyjazd pojechało dwudziestu kibiców. Wszyscy zapamiętali, kto im odmówił.'
        },
      },
    ],
  },
  {
    id: 'fizjoterapeuta_odchodzi',
    minLevel: 5,
    maxLevel: 6,
    once: true,
    text: 'Pan Zdzisław, klubowy fizjoterapeuta od piętnastu lat, dostał ofertę z klubu siatkarskiego. „Tam przynajmniej nikt nie symuluje”.',
    options: [
      {
        label: 'Podwyżka z budżetu klubu',
        apply: ({ s }) => {
          const c = money(s, 150)
          if (!pay(s, c)) {
            trust(s, 0, -3, 0)
            mod(s, 'Brak fizjoterapeuty', -0.5, 2)
            return 'Na podwyżkę nie ma pieniędzy. Pan Zdzisław odchodzi, a w gabinecie zostaje tylko maść końska.'
          }
          trust(s, 0, 4, 0)
          return `Pan Zdzisław zostaje za ${k(c)} więcej. Na pożegnanie z siatkarzami wysłał im kartkę z napisem „może kiedyś”.`
        },
      },
      {
        label: 'Zatrudnij studenta fizjoterapii',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            trust(s, 0, 2, 0)
            return 'Student zna najnowsze metody, taśmy w trzech kolorach i nazwy wszystkich mięśni po łacinie. Zawodnicy zachwyceni.'
          }
          mod(s, 'Niedoświadczona odnowa', -0.5, 2)
          return 'Student pomylił łydkę z udem. Dwa razy. Zawodnicy wolą teraz masować się nawzajem.'
        },
      },
      {
        label: 'Pożegnaj go z honorami',
        apply: ({ s }) => {
          trust(s, 0, 1, 2)
          mod(s, 'Brak fizjoterapeuty', -0.5, 2)
          return 'Pan Zdzisław dostaje oprawioną koszulkę z podpisami. W gabinecie zostaje jego kubek i pusta półka po taśmach.'
        },
      },
    ],
  },
  {
    id: 'juniorzy_do_pierwszego',
    minLevel: 5,
    maxLevel: 6,
    cooldown: 40,
    condition: (s) => s.squad.some((p) => p.age <= 20),
    text: 'Trener juniorów prosi, żeby jego najlepsi chłopcy trenowali z pierwszym zespołem. „Bez tego nigdy nie zrozumieją, jak się gra w seniorach”.',
    options: [
      {
        label: 'Zgoda, młodzi trenują z nami',
        apply: ({ s }) => {
          s.squad.filter((p) => p.age <= 20).forEach((p) => {
            p.progress += 0.4
            setMorale(p, 6)
          })
          trust(s, 2, -1, 2)
          return 'Młodzi biegają za starszymi jak cienie. Weterani narzekają na tempo, ale po cichu się cieszą.'
        },
      },
      {
        label: 'Tylko na jeden trening w tygodniu',
        apply: ({ s }) => {
          s.squad.filter((p) => p.age <= 20).forEach((p) => (p.progress += 0.2))
          trust(s, 1, 0, 1)
          return 'Kompromis przyjęty. Juniorzy przychodzą w czwartki i noszą pachołki z największym entuzjazmem w historii klubu.'
        },
      },
      {
        label: 'Najpierw niech wygrają swoją ligę',
        apply: ({ s }) => {
          s.squad.filter((p) => p.age <= 20).forEach((p) => setMorale(p, -6))
          trust(s, -1, 1, -1)
          return 'Trener juniorów obraził się i od teraz mówi o Tobie „ten pan z seniorów”.'
        },
      },
    ],
  },

  // ---------- nowe: piłka zawodowa (III liga – Ekstraklasa) ----------
  {
    id: 'prezes_wpis_noca',
    minLevel: 7,
    cooldown: 40,
    text: 'Prezes w nocy wrzuca wpis: „Zmiany w 60. minucie? Ciekawe podejście”. Do rana ma dwa tysiące komentarzy, a portale cytują go w nagłówkach.',
    options: [
      {
        label: 'Odpowiedz publicznie',
        apply: ({ s, rng }) => {
          coach(s, 5)
          if (rng.chance(0.4)) {
            trust(s, 2, 3, 4)
            return '„Zmiany w 60. minucie to klasyka, prezesie. Jak schabowy w niedzielę” – odpisałeś. Nawet prezes dał serduszko.'
          }
          trust(s, -7, 2, 2)
          scandal(s, 'Kłótnia trenera z prezesem w mediach społecznościowych')
          return 'Wymiana wpisów trwała do południa. Rzecznik klubu wziął urlop na żądanie.'
        },
      },
      {
        label: 'Umów się na rozmowę w cztery oczy',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            trust(s, 4, 0, 0)
            return 'Prezes przyznał, że „emocje poniosły”. Wpis zniknął, a Ty dostałeś zapewnienie, że do końca rundy żadnych wpisów po północy.'
          }
          trust(s, -2, 0, 0)
          coach(s, 3)
          return 'Rozmowa skończyła się wykładem prezesa o tym, jak sam trenował juniorów w 1994 roku.'
        },
      },
      {
        label: 'Przemilcz sprawę',
        apply: ({ s }) => {
          trust(s, 1, -2, -1)
          coach(s, 3)
          return 'Milczysz. Szatnia odbiera to jako słabość, prezes jako zgodę na kolejne wpisy.'
        },
      },
    ],
  },
  {
    id: 'bol_na_rozgrzewce',
    minLevel: 6,
    cooldown: 10,
    player: (p) => p.apps >= 2 && p.injuredFor === 0 && p.suspendedFor === 0,
    text: '{p} na rozgrzewce przed meczem łapie się za udo. Lekarz klubowy mówi: „Pięćdziesiąt na pięćdziesiąt, trenerze”.',
    options: [
      {
        label: 'Gra od początku',
        apply: ({ p, rng }) => {
          if (rng.chance(0.4)) {
            p!.injuredFor = rng.int(2, 4)
            return `{ps} wytrzymał 20 minut i zszedł, kulejąc. Przerwa: ${p!.injuredFor} mecze. Lekarz ma minę „a nie mówiłem”.`
          }
          setMorale(p!, 6)
          return '{ps} zagrał całe spotkanie. Po meczu przyznał, że czuł udo tylko przy dwóch sprintach.'
        },
      },
      {
        label: 'Ławka, wejdzie w razie potrzeby',
        apply: ({ p, rng }) => {
          setMorale(p!, -3)
          if (rng.chance(0.15)) {
            p!.injuredFor = 1
            return '{ps} wszedł na ostatnie pół godziny i znów poczuł udo. Jeden mecz przerwy profilaktycznie.'
          }
          return '{ps} siedzi na ławce w kurtce i obserwuje. Lekarz odetchnął.'
        },
      },
      {
        label: 'Odpoczywa, zdrowie przede wszystkim',
        apply: ({ s, p }) => {
          p!.injuredFor = Math.max(p!.injuredFor, 1)
          trust(s, 0, 2, 0)
          return '{ps} pauzuje jeden mecz. Szatnia widzi, że sztab nie ryzykuje zdrowiem zawodników.'
        },
      },
    ],
  },
  {
    id: 'koszulki_literowka',
    minLevel: 6,
    once: true,
    text: 'Nowe koszulki trafiły do sklepu kibica. Na plecach i w herbie jest literówka w nazwie miasta: zamiast „{miasto}” wydrukowano coś, co brzmi jak nazwa leku na zgagę.',
    options: [
      {
        label: 'Wycofaj całą partię',
        apply: ({ s }) => {
          const c = money(s, 120)
          if (!pay(s, c)) {
            trust(s, -2, 0, -2)
            return 'Na nowy nadruk nie ma pieniędzy. Koszulki leżą w magazynie, a sklep kibica sprzedaje szaliki z zeszłego sezonu.'
          }
          trust(s, 2, 0, 1)
          return `Partia wycofana (${k(c)}). Producent przeprosił i obiecał, że następnym razem użyje korektora.`
        },
      },
      {
        label: 'Ogłoś edycję kolekcjonerską',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            s.budget += money(s, 150)
            trust(s, 3, 0, 4)
            return 'Edycja „z błędem” wyprzedała się w dwa dni. Kolekcjonerzy z całego kraju pytają o dodruk.'
          }
          trust(s, -2, 0, -3)
          scandal(s, 'Koszulki z błędem w nazwie miasta')
          return 'Nikt nie uwierzył, że to celowo. Memy z „nową nazwą miasta” żyją własnym życiem.'
        },
      },
    ],
  },
  {
    id: 'jezyki_w_szatni',
    minLevel: 7,
    cooldown: 60,
    text: 'Obcokrajowcy w szatni trzymają się we własnej grupie. Na odprawach połowa kiwa głowami, choć nic nie rozumie, a druga połowa nie rozumie, czemu tamci kiwają.',
    options: [
      {
        label: 'Zatrudnij tłumacza',
        apply: ({ s }) => {
          const c = money(s, 80)
          if (!pay(s, c)) {
            trust(s, 0, 1, 0)
            return 'Na tłumacza nie ma pieniędzy. Odprawy prowadzisz z tłumaczem internetowym, który „podanie” tłumaczy jako „wniosek urzędowy”.'
          }
          mod(s, 'Wspólny język', 0.5, 3)
          trust(s, 0, 3, 0)
          return `Tłumacz kosztuje ${k(c)}, ale odprawy wreszcie mają sens. Zgrzyty w defensywie zniknęły.`
        },
      },
      {
        label: 'Obowiązkowy kurs polskiego',
        apply: ({ s, rng }) => {
          if (rng.chance(0.55)) {
            teamMorale(s, 3)
            mod(s, 'Wspólny język', 0.5, 2)
            return 'Po trzech tygodniach wszyscy obcokrajowcy umieją powiedzieć „podaj”, „uważaj” i „sędzia kalosz”. Wystarczy.'
          }
          teamMorale(s, -3)
          return 'Kurs zatrzymał się na odmianie przez przypadki. Dwóch zawodników poważnie rozważa powrót do domu.'
        },
      },
      {
        label: 'Piłka to język uniwersalny',
        apply: ({ s }) => {
          trust(s, 0, -2, 0)
          mod(s, 'Pomieszanie języków', -0.5, 2)
          return 'Na boisku dwa razy zderzyło się dwóch zawodników krzyczących „moja!” w dwóch różnych językach.'
        },
      },
    ],
  },
  {
    id: 'otwarty_trening',
    minLevel: 6,
    cooldown: 30,
    text: 'Stowarzyszenie kibiców prosi o otwarty trening z autografami dla dzieci. Termin: dwa dni przed meczem.',
    options: [
      {
        label: 'Zgoda, robimy święto',
        apply: ({ s }) => {
          trust(s, 2, 0, 7)
          teamMorale(s, 4)
          mod(s, 'Trening na pokaz', -0.5, 1)
          return 'Na trening przyszło trzy tysiące osób. Zawodnicy podpisali wszystko, co dało się podpisać, łącznie z gipsem jednego taty.'
        },
      },
      {
        label: 'Tak, ale po meczu',
        apply: ({ s }) => {
          trust(s, 1, 1, 4)
          return 'Otwarty trening po meczu: luźna gra z dziećmi i karne z maskotką. Wszyscy zadowoleni.'
        },
      },
      {
        label: 'Odmów, przygotowania są tajne',
        apply: ({ s }) => {
          trust(s, 0, 1, -5)
          return 'Kibice na forum piszą o „trenerze w twierdzy”. Ktoś przyniósł lornetkę na pobliski balkon.'
        },
      },
    ],
  },
  {
    id: 'murawa_po_koncercie',
    minLevel: 7,
    cooldown: 60,
    text: 'Miasto wynajęło stadion na koncert gwiazdy pop. Po trzech dniach scena zniknęła, ale murawa wygląda jak pole po ulewie.',
    options: [
      {
        label: 'Wymień murawę z budżetu klubu',
        apply: ({ s }) => {
          const c = money(s, 300)
          if (!pay(s, c)) {
            trust(s, -2, 0, -1)
            mod(s, 'Murawa po koncercie', -1, 2)
            return 'Na nową murawę nie ma pieniędzy. Greenkeeper dosiewa trawę i modli się o deszcz.'
          }
          trust(s, 2, 0, 2)
          return `Nowa murawa z rolki (${k(c)}). Zawodnicy biegają jak po dywanie, księgowa chodzi jak po rozżarzonych węglach.`
        },
      },
      {
        label: 'Domagaj się odszkodowania od miasta',
        apply: ({ s, rng }) => {
          coach(s, 3)
          mod(s, 'Murawa po koncercie', -1, 2)
          if (rng.chance(0.5)) {
            s.budget += money(s, 150)
            return 'Miasto wypłaciło odszkodowanie. Murawa wciąż fatalna, ale przynajmniej ktoś za to zapłacił.'
          }
          trust(s, -1, 0, 0)
          return 'Miasto twierdzi, że „murawa była w złym stanie już przed koncertem”. Sprawa w toku.'
        },
      },
      {
        label: 'Zmień styl: gramy długą piłką',
        apply: ({ s }) => {
          s.tactic.style = 'laga'
          mod(s, 'Murawa po koncercie', -0.5, 2)
          return 'Na takiej murawie krótkie podania nie mają szans. Ofensywny pomocnik patrzy w niebo, bo tam teraz lata piłka.'
        },
      },
    ],
  },
  {
    id: 'sesja_reklamowa',
    minLevel: 7,
    cooldown: 40,
    player: (p, s) => p.skill >= topSkill(s, 4) && p.injuredFor === 0,
    text: '{p} ma podpisać kontrakt reklamowy z producentem napojów izotonicznych. Sesja zdjęciowa wypada w środę, w trakcie treningu taktycznego.',
    options: [
      {
        label: 'Zgoda, niech zarabia',
        apply: ({ s, p }) => {
          setMorale(p!, 12)
          trust(s, 0, -2, 1)
          mod(s, 'Lider na sesji zdjęciowej', -0.5, 1)
          return '{ps} pozuje z butelką w zwolnionym tempie. Na treningu taktycznym zastąpił go pachołek. Pachołek był ustawiony lepiej.'
        },
      },
      {
        label: 'Przełóż sesję na dzień wolny',
        apply: ({ p, rng }) => {
          if (rng.chance(0.7)) {
            setMorale(p!, 6)
            return 'Producent zgodził się na poniedziałek. {ps} zadowolony, a trening odbył się w komplecie.'
          }
          setMorale(p!, -8)
          return 'Producent nie zgodził się na zmianę i podpisał kontrakt z zawodnikiem rywala. {ps} długo tego nie zapomni.'
        },
      },
      {
        label: 'Zakaz, trening ważniejszy',
        apply: ({ s, p }) => {
          setMorale(p!, -15)
          trust(s, 2, 1, 0)
          return '{ps} stracił kontrakt reklamowy. Na treningu jest, ale podania kieruje głównie w Twoją stronę.'
        },
      },
    ],
  },
  {
    id: 'przeciek_skladu',
    minLevel: 7,
    cooldown: 60,
    text: 'Dzień przed meczem portal publikuje Twój wyjściowy skład co do zawodnika. Ktoś z klubu ma bardzo długi język.',
    options: [
      {
        label: 'Śledztwo w szatni',
        apply: ({ s, rng }) => {
          coach(s, 5)
          if (rng.chance(0.4)) {
            trust(s, 3, 2, 0)
            return 'Winny znaleziony: kuzyn kierowcy autokaru, który „tylko wspomniał na grupie rodzinnej”. Przeciek zatkany.'
          }
          trust(s, 0, -6, 0)
          return 'Śledztwo nic nie dało, za to wszyscy podejrzewają wszystkich. Na odprawie panuje cisza jak na pogrzebie.'
        },
      },
      {
        label: 'Na odprawie podaj fałszywy skład',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            mod(s, 'Rywal zaskoczony', 1, 1)
            trust(s, 0, 2, 0)
            return 'Portal opublikował fałszywy skład, rywal ustawił się pod niego. Prawdziwy skład zaskoczył wszystkich, łącznie z dwoma zawodnikami.'
          }
          mod(s, 'Zamieszanie ze składem', -1, 1)
          trust(s, 0, -3, 0)
          return 'Zawodnicy uwierzyli w fałszywy skład bardziej niż rywal. Trzech przygotowało się do innych pozycji.'
        },
      },
      {
        label: 'Zignoruj, wynik się obroni',
        apply: ({ s }) => {
          mod(s, 'Przeciek ze składu', -0.5, 1)
          return 'Rywal wiedział, kto zagra. Nie wiedział za to, jak zagra, i to też jakaś pociecha.'
        },
      },
    ],
  },
  {
    id: 'skauci_na_trybunach',
    minLevel: 6,
    cooldown: 40,
    player: (p, s) => p.skill >= topSkill(s, 4) && p.apps >= 3 && p.age <= 28,
    text: 'Na trybunie siedzą skauci z ligi czeskiej i duńskiej. Wszyscy wiedzą, że przyjechali oglądać {p}. Zawodnik wie to najlepiej.',
    options: [
      {
        label: '„Graj swoje, reszta przyjdzie w oknie”',
        apply: ({ p, rng }) => {
          setMorale(p!, 6)
          if (rng.chance(0.6)) {
            nudgeForm(p!, 1)
            return '{ps} zagrał spokojnie i dojrzale. Skauci zapisali coś w notesach i wyszli przed końcem, żeby zdążyć na samolot.'
          }
          nudgeForm(p!, -1)
          return '{ps} chciał się pokazać i próbował przelobować bramkarza z połowy boiska. Cztery razy.'
        },
      },
      {
        label: 'Posadź go na ławce, niech ochłonie',
        apply: ({ s, p }) => {
          setMorale(p!, -12)
          trust(s, 0, -2, -2)
          return '{ps} spędził mecz na ławce. Skauci przyjadą znowu, ale teraz zapisali w notesach coś o „trudnych relacjach z trenerem”.'
        },
      },
      {
        label: 'Porozmawiaj z nim o planie na karierę',
        apply: ({ s, p }) => {
          setMorale(p!, 4)
          p!.progress += 0.3
          coach(s, 0, 1)
          return 'Długa rozmowa o tym, że transfery robi się w oknie, a forma w każdym tygodniu. {ps} kiwa głową i zostaje po treningu.'
        },
      },
    ],
  },
  {
    id: 'agent_zapowiada_zime',
    minLevel: 7,
    cooldown: 40,
    player: (p, s) => p.age <= 28 && p.skill >= median(s) && p.apps >= 3,
    text: 'Agent {p} dzwoni z „informacją z rynku”: zimą zgłoszą się po niego dwa kluby z wyższej półki. Na razie chce tylko, żeby klub „był przygotowany psychicznie”.',
    options: [
      {
        label: 'Obiecaj rozmowy w zimowym oknie',
        apply: ({ s, p }) => {
          setMorale(p!, 8)
          trust(s, 1, 0, -2)
          s.flags[`zima:${p!.id}`] = s.season
          return '{ps} spokojny, że klub nie będzie robił problemów. Agent spokojny, że dostanie prowizję. Ty jesteś mniej spokojny.'
        },
      },
      {
        label: '„Nie jest na sprzedaż”',
        apply: ({ s, p }) => {
          setMorale(p!, -10)
          trust(s, 2, 0, 5)
          return 'Kibice wywiesili transparent „{ps} zostaje”. Agent odpowiedział wpisem o „szacunku dla ambicji zawodnika”.'
        },
      },
      {
        label: 'Zignoruj telefon',
        apply: ({ p, rng }) => {
          if (rng.chance(0.5)) return 'Agent dzwonił jeszcze cztery razy, potem dał spokój. {ps} chyba nawet nie wiedział o tych rozmowach.'
          setMorale(p!, -6)
          return 'Agent opowiedział {ps}, że „klub go nie szanuje”. Zawodnik od tygodnia nie patrzy Ci w oczy.'
        },
      },
    ],
  },
  {
    id: 'sztab_klotnia',
    minLevel: 7,
    cooldown: 60,
    text: 'Asystent i trener przygotowania motorycznego pokłócili się o obciążenia treningowe. Jeden chce więcej gierek, drugi więcej sprintów. Obaj chcą, żebyś przyznał mu rację.',
    options: [
      {
        label: 'Stań po stronie asystenta',
        apply: ({ s, rng }) => {
          mod(s, 'Więcej gierek', 0.5, 2)
          if (rng.chance(0.3)) {
            const p = rng.pick(s.squad)
            p.injuredFor = Math.max(p.injuredFor, 2)
            return `Gierki wróciły, motoryczny obrażony. ${p.firstName[0]}. ${p.lastName} naciągnął mięsień, a motoryczny powiedział tylko: „no właśnie”.`
          }
          return 'Więcej piłki na treningach, zawodnicy zadowoleni. Motoryczny zapisuje wszystko w zeszycie „na później”.'
        },
      },
      {
        label: 'Stań po stronie motorycznego',
        apply: ({ s }) => {
          teamMorale(s, -3)
          s.squad.forEach((p) => (p.progress += 0.05))
          mod(s, 'Twarde nogi', 0.5, 2)
          return 'Sprinty, skipy, sanki obciążeniowe. Zawodnicy mają mniej zabawy, ale w końcówkach meczów biegają za dwóch.'
        },
      },
      {
        label: 'Mediacja i wspólny plan',
        apply: ({ s, rng }) => {
          coach(s, 4)
          if (rng.chance(0.6)) {
            trust(s, 2, 2, 0)
            mod(s, 'Zgodny sztab', 0.5, 2)
            return 'Po dwóch godzinach i trzech kawach powstał wspólny plan. Obaj twierdzą, że to był ich pomysł.'
          }
          trust(s, 0, -2, 0)
          return 'Mediacja skończyła się tym, że obaj są obrażeni na Ciebie. Przynajmniej znowu się ze sobą zgadzają.'
        },
      },
    ],
  },
  {
    id: 'zakaz_wyjazdowy',
    minLevel: 7,
    cooldown: 60,
    text: 'Wojewoda wydał zakaz wyjazdowy dla waszych kibiców na najbliższy mecz. Stowarzyszenie kibiców czeka na reakcję klubu i trenera.',
    options: [
      {
        label: 'Publicznie skrytykuj decyzję',
        apply: ({ s }) => {
          trust(s, -3, 0, 7)
          coach(s, 2)
          return 'Kibice udostępniają Twoją wypowiedź z dopiskiem „nasz człowiek”. Zarząd wolałby, żebyś mówił tylko o piłce.'
        },
      },
      {
        label: 'Zaapeluj o spokój',
        apply: ({ s }) => {
          trust(s, 4, 0, -3)
          return 'Zarząd docenia dojrzałą postawę. Kibice uważają, że trener „gra w drużynie wojewody”.'
        },
      },
      {
        label: 'Zadedykuj kibicom najbliższy mecz',
        apply: ({ s }) => {
          trust(s, 0, 2, 4)
          mod(s, 'Gramy dla tych, co zostali w domu', 0.5, 1)
          return 'Zawodnicy wyszli na rozgrzewkę w koszulkach z napisem „Gramy dla Was”. Neutralnie, a skutecznie.'
        },
      },
    ],
  },
  {
    id: 'dane_gps_najmniej',
    minLevel: 7,
    cooldown: 15,
    player: (p) => p.apps >= 3 && p.injuredFor === 0 && p.pos !== 'BR',
    text: 'Dane GPS z ostatniego meczu: {p} przebiegł najmniej w drużynie, mniej nawet niż bramkarz w pierwszej połowie.',
    options: [
      {
        label: 'Pokaż dane na odprawie przy wszystkich',
        apply: ({ s, p, rng }) => {
          setMorale(p!, -10)
          trust(s, 1, -1, 0)
          if (rng.chance(0.6)) {
            nudgeForm(p!, 1)
            return '{ps} w następnym meczu biegał tak, że analitycy myśleli, że kamizelka się zepsuła.'
          }
          nudgeForm(p!, -1)
          return '{ps} uważa, że go upokorzyłeś. Biega teraz jeszcze mniej, ale za to z wyrzutem.'
        },
      },
      {
        label: 'Rozmowa w cztery oczy',
        apply: ({ p, rng }) => {
          setMorale(p!, 4)
          if (rng.chance(0.5)) {
            nudgeForm(p!, 1)
            return 'Okazało się, że {ps} gra od miesiąca z bolącym palcem u stopy. Fizjoterapeuta zajął się sprawą, wyniki GPS wracają do normy.'
          }
          return '{ps} obiecał poprawę. Analitycy sprawdzą to w poniedziałek.'
        },
      },
      {
        label: '„Dane nie strzelają goli”',
        apply: ({ s, p }) => {
          setMorale(p!, 5)
          trust(s, -1, 1, 0)
          return 'Analitycy są zawiedzeni, {ps} zachwycony. Biega dalej tyle samo, czyli mało.'
        },
      },
    ],
  },
  {
    id: 'lot_odwolany',
    minLevel: 8,
    cooldown: 40,
    text: 'Lot na mecz wyjazdowy odwołano z powodu mgły. Do spotkania zostało 30 godzin, a do przejechania ponad 500 kilometrów.',
    options: [
      {
        label: 'Wynajmij samolot czarterowy',
        apply: ({ s }) => {
          const c = money(s, 60)
          if (!pay(s, c)) {
            mod(s, 'Dziewięć godzin w autokarze', -1, 1)
            return 'Na czarter nie ma pieniędzy. Dziewięć godzin w autokarze, trzy filmy i jeden koncert karaoke kierowcy.'
          }
          mod(s, 'Wyspani na wyjeździe', 0.5, 1)
          return `Czarter kosztował ${k(c)}, ale drużyna wylądowała wieczorem i wyspała się w hotelu.`
        },
      },
      {
        label: 'Autokar od razu',
        apply: ({ s }) => {
          mod(s, 'Dziewięć godzin w autokarze', -1, 1)
          trust(s, 1, -2, 0)
          return 'Dziewięć godzin w autokarze. Rozgrzewka przed meczem wyglądała jak poranna gimnastyka w sanatorium.'
        },
      },
      {
        label: 'Nocny pociąg',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            teamMorale(s, 4)
            return 'Nocny pociąg, kuszetki i gra w karty do pierwszej. Drużyna dojechała wyspana i zintegrowana.'
          }
          mod(s, 'Nocka w pociągu', -0.5, 1)
          return 'Pociąg stał dwie godziny w polu. Kapitan prowadził rozciąganie na korytarzu wagonu.'
        },
      },
    ],
  },
  {
    id: 'syn_wlasciciela_dyrektor',
    minLevel: 8,
    once: true,
    text: 'Właściciel mianował syna dyrektorem ds. rozwoju. Młody wrócił ze studiów w Londynie i chce wdrożyć „metodę z podcastu”: treningi o 6:00 i zimne kąpiele dla całej kadry.',
    options: [
      {
        label: 'Przyjmij z uśmiechem, rób swoje',
        apply: ({ s }) => {
          trust(s, 4, 0, 0)
          coach(s, 6)
          return 'Kiwasz głową na spotkaniach, a treningi zostają o 10:00. Dyrektor chwali się w podcaście „zmianą kultury w klubie”.'
        },
      },
      {
        label: 'Postaw jasne granice',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            trust(s, 1, 4, 0)
            coach(s, 0, 2)
            return 'Właściciel przyznał Ci rację: „Synek, trening zostaw trenerowi”. Dyrektor zajął się nowym logo.'
          }
          trust(s, -8, 4, 0)
          coach(s, 6)
          return 'Właściciel stanął po stronie syna. Szatnia za Tobą, gabinet prezesa już nie.'
        },
      },
      {
        label: 'Zaproponuj mu pilotaż w akademii',
        apply: ({ s }) => {
          trust(s, 3, 1, 0)
          s.squad.filter((p) => p.age <= 20).forEach((p) => (p.progress += 0.2))
          return 'Juniorzy trenują o świcie i kąpią się w lodzie. O dziwo, robią postępy. Dyrektor jest zachwycony, Ty też.'
        },
      },
    ],
  },
  {
    id: 'stulecie_klubu',
    minLevel: 6,
    once: true,
    text: '{klub} świętuje okrągły jubileusz. Zarząd planuje galę, mecz w strojach retro i wielką oprawę. Do Ciebie należy przemówienie.',
    options: [
      {
        label: 'Mecz w koszulkach retro',
        apply: ({ s }) => {
          s.budget += money(s, 120)
          trust(s, 3, 2, 7)
          mod(s, 'Duch historii', 1, 1)
          return 'Bawełniane koszulki ze sznurowanym kołnierzykiem, dziadkowie na trybunach w łzach. Sprzedaż replik pobiła rekord.'
        },
      },
      {
        label: 'Wzruszające przemówienie na gali',
        apply: ({ s, rng }) => {
          if (rng.chance(0.65)) {
            trust(s, 4, 0, 5)
            coach(s, 0, 2)
            return 'Mówiłeś pięć minut, sala płakała dziesięć. Nawet prezes ocierał oczy krawatem.'
          }
          trust(s, -1, 0, -1)
          coach(s, 3)
          return 'Pomyliłeś rok założenia klubu. Najstarszy kibic poprawił Cię z sali, przez mikrofon.'
        },
      },
      {
        label: 'Skup się na lidze, gala bez trenera',
        apply: ({ s }) => {
          trust(s, -3, 1, -4)
          return 'Na gali Twoje krzesło stało puste. Prezes w przemówieniu podziękował „trenerowi, który jest myślami na boisku”.'
        },
      },
    ],
  },
  {
    id: 'gry_po_nocach',
    minLevel: 6,
    cooldown: 20,
    player: (p) => p.age <= 26 && p.apps >= 2,
    text: '{p} gra po nocach w strzelanki online. Kumple z drużyny twierdzą, że ma lepsze wyniki w rankingu niż na boisku, a na treningi przychodzi z oczami jak u sowy.',
    options: [
      {
        label: 'Zakaz grania po 23:00',
        apply: ({ p, rng }) => {
          setMorale(p!, -8)
          if (rng.chance(0.6)) {
            nudgeForm(p!, 1)
            return '{ps} śpi po osiem godzin i nagle widzi więcej na boisku. Ranking w grze spada, ranking w drużynie rośnie.'
          }
          return '{ps} zmienił tylko konsolę na laptopa, bo „zakaz dotyczył konsoli”. Prawnik byłby dumny.'
        },
      },
      {
        label: 'Klubowy turniej e-sportowy',
        apply: ({ s, p }) => {
          teamMorale(s, 5)
          setMorale(p!, 8)
          trust(s, 0, 3, 1)
          return 'Turniej w świetlicy klubowej wygrał bramkarz rezerw. {ps} od teraz gra mniej, bo nie może się z tym pogodzić.'
        },
      },
      {
        label: 'Jego czas wolny, jego sprawa',
        apply: ({ p }) => {
          nudgeForm(p!, -1)
          setMorale(p!, 4)
          return '{ps} gra dalej. W meczu dwa razy próbował zmienić broń, ale piłka została ta sama.'
        },
      },
    ],
  },
  {
    id: 'wyklad_kurs_trenerski',
    minLevel: 7,
    cooldown: 60,
    text: 'Szkoła trenerów zaprasza Cię na wykład dla kursantów licencji UEFA. Temat: „Zarządzanie szatnią w kryzysie”. Termin: dzień przed meczem.',
    options: [
      {
        label: 'Jedź i opowiedz o swoich metodach',
        apply: ({ s, rng }) => {
          mod(s, 'Trener na wykładzie', -0.5, 1)
          if (rng.chance(0.7)) {
            coach(s, -3, 3)
            return 'Kursanci robili notatki, jeden poprosił o zdjęcie. W środowisku mówią o Tobie z coraz większym szacunkiem.'
          }
          coach(s, 3, -1)
          return 'Kursant zapytał, dlaczego w takim razie Twoja drużyna przegrała trzy z ostatnich pięciu. Cisza na sali.'
        },
      },
      {
        label: 'Wykład online po meczu',
        apply: ({ s }) => {
          coach(s, 0, 1)
          return 'Wykład przez kamerę z gabinetu. W tle widać tablicę taktyczną, którą kursanci przeanalizowali dokładniej niż wykład.'
        },
      },
      {
        label: 'Odmów, liczy się mecz',
        apply: ({ s }) => {
          trust(s, 2, 0, 0)
          return 'Prezes docenia skupienie na klubie. Wykład poprowadził trener, który niedawno został zwolniony. Mówił o kryzysie z autopsji.'
        },
      },
    ],
  },
  {
    id: 'karny_kontrowersja',
    minLevel: 6,
    cooldown: 20,
    condition: (s) => s.streak[s.streak.length - 1] === 'L',
    text: 'Po porażce dziennikarze pytają tylko o jedno: rzut karny podyktowany przeciwko wam w 89. minucie. Na powtórkach nie widać kontaktu.',
    options: [
      {
        label: 'Skrytykuj sędziego wprost',
        apply: ({ s }) => {
          const c = fine(s, money(s, 60))
          trust(s, -2, 4, 5)
          coach(s, 2, -1)
          return c > 0
            ? `Kara za wypowiedź: ${k(c)}. Kibice drukują Twój cytat na szalikach.`
            : 'Komisja dyscyplinarna nałożyła karę, którą klub zapłaci „jak będzie z czego”. Kibice drukują Twój cytat na szalikach.'
        },
      },
      {
        label: 'Dyplomatycznie: „Sędzia też człowiek”',
        apply: ({ s }) => {
          trust(s, 3, -1, -2)
          coach(s, -1, 1)
          return 'Wypowiedź godna podręcznika. Kolegium sędziów zapamięta ją dobrze, kibice gorzej.'
        },
      },
      {
        label: 'Ironicznie pochwal sędziego',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            trust(s, 0, 3, 4)
            return '„Sędzia widział coś, czego nie widziało dziesięć kamer. Gratuluję wzroku”. Internet kocha tę wypowiedź.'
          }
          fine(s, money(s, 40))
          scandal(s, 'Ironiczna wypowiedź o sędzim na konferencji')
          coach(s, 3)
          return 'Komisja dyscyplinarna nie zrozumiała ironii. Albo zrozumiała aż za dobrze.'
        },
      },
    ],
  },
  {
    id: 'mecz_charytatywny',
    minLevel: 6,
    cooldown: 60,
    text: 'Zawodnicy chcą w dzień wolny zagrać w meczu charytatywnym dla chorego chłopca z okolicy. Lekarz klubowy przypomina, że w niedzielę jest liga.',
    options: [
      {
        label: 'Gramy, to ważniejsze',
        apply: ({ s, rng }) => {
          trust(s, 2, 5, 8)
          coach(s, -2, 2)
          teamMorale(s, 6)
          if (rng.chance(0.2)) {
            const p = rng.pick(s.squad)
            p.injuredFor = Math.max(p.injuredFor, 1)
            return `Zebrano rekordową kwotę, a ${p.firstName[0]}. ${p.lastName} skręcił kostkę przy cieszynce z dziećmi. Mecz przerwy, ale nikt nie żałuje.`
          }
          return 'Zebrano rekordową kwotę. Chłopiec wykonał rzut karny, bramkarz rzucił się w złą stronę z wielkim aktorstwem.'
        },
      },
      {
        label: 'Tylko sztab i weterani',
        apply: ({ s }) => {
          trust(s, 1, 2, 5)
          coach(s, 0, 1)
          return 'Sztab i weterani zagrali z lokalnymi celebrytami. Ty strzeliłeś gola i opowiadasz o tym od tygodnia.'
        },
      },
      {
        label: 'Licytacja koszulek zamiast meczu',
        apply: ({ s }) => {
          trust(s, 1, 0, 3)
          return 'Koszulki z podpisami poszły na licytacji za wysokie kwoty. Dobra sprawa, zero ryzyka kontuzji.'
        },
      },
    ],
  },
]
