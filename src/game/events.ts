import type { Rng } from './rng'
import type { GameState, Player, TraitId } from './types'

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
  /** zdarzenie dotyczy zawodnika: dowolnego albo z daną cechą */
  player?: 'any' | TraitId
  condition?: (s: GameState) => boolean
  /** {p} pełne imię zawodnika, {ps} skrót, {klub}, {miasto}, {trener} */
  text: string
  options: { label: string; apply: (c: EventCtx) => string }[]
}

const cl = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, Math.round(v)))

function trust(s: GameState, board = 0, squad = 0, fans = 0): void {
  s.trust.board = cl(s.trust.board + board)
  s.trust.squad = cl(s.trust.squad + squad)
  s.trust.fans = cl(s.trust.fans + fans)
}

function teamMorale(s: GameState, d: number): void {
  for (const p of s.squad) p.morale = cl(p.morale + d)
}

function teamForm(s: GameState, d: number): void {
  for (const p of s.squad) p.form = cl(p.form + d, -3, 3)
}

function rep(s: GameState, d: number): void {
  s.coach.reputation = cl(s.coach.reputation + d)
}

function scandal(s: GameState, text: string): void {
  s.scandals.push(text)
}

const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)} tys. zł` : `${v} zł`)
/** kwota zależna od poziomu ligi */
const money = (s: GameState, base: number) => Math.round(base * Math.pow(2.2, s.teams[s.clubId!].level))

export const EVENTS: GameEvent[] = [
  {
    id: 'wesele',
    player: 'any',
    text: '{p} przyszedł na trening prosto z wesela kuzyna. Jest w garniturze i mówi, że „da radę”.',
    options: [
      {
        label: 'Odeślij go do domu i ukarz finansowo',
        apply: ({ s, p }) => {
          p!.morale = cl(p!.morale - 15)
          trust(s, 2, -2, 0)
          return '{ps} obrażony, ale szatnia zrozumiała przekaz.'
        },
      },
      {
        label: 'Niech trenuje, przynajmniej przyszedł',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.5)) {
            p!.injuredFor = 2
            return '{ps} naciągnął mięsień przy rozgrzewce w lakierkach. Dwa tygodnie przerwy.'
          }
          trust(s, 0, 3, 0)
          return '{ps} strzelił na treningu trzy gole. Szatnia uważa, że wesela powinny być obowiązkowe.'
        },
      },
      {
        label: 'Zrób z tego wydarzenie: cała drużyna idzie na poprawiny',
        apply: ({ s, rng }) => {
          teamMorale(s, 10)
          teamForm(s, -1)
          if (rng.chance(0.3)) {
            scandal(s, 'Cała drużyna na poprawinach w środku sezonu')
            trust(s, -10, 8, 4)
            return 'Zdjęcia z poprawin trafiły do lokalnej gazety. Prezes nie jest zachwycony.'
          }
          trust(s, 0, 8, 2)
          return 'Wspaniała zabawa. Integracja na najwyższym poziomie, kondycja na najniższym.'
        },
      },
    ],
  },
  {
    id: 'wojt_syn',
    maxLevel: 3,
    text: 'Wójt gminy przyszedł na trening. Jego syn „ma papiery na granie” i powinien zagrać w pierwszym składzie.',
    options: [
      {
        label: 'Daj synowi szansę',
        apply: ({ s, rng }) => {
          s.budget += money(s, 3000)
          teamMorale(s, -5)
          return rng.chance(0.2)
            ? 'Syn wójta strzelił samobója i uciekł z boiska. Ale gmina dorzuciła na nowe bramki.'
            : 'Syn wójta zagrał 30 minut, dotknął piłki dwa razy. Gmina dorzuca do budżetu.'
        },
      },
      {
        label: 'Grzecznie odmów',
        apply: ({ s }) => {
          trust(s, -6, 4, 0)
          return 'Wójt wyszedł bez słowa. Następnego dnia na boisku wyłączono wodę.'
        },
      },
    ],
  },
  {
    id: 'masarnia',
    maxLevel: 4,
    text: 'Sponsor główny, lokalna masarnia, grozi wycofaniem się. Chce, żeby zawodnicy grali w koszulkach z wielką kiełbasą.',
    options: [
      {
        label: 'Zgódź się na kiełbasę',
        apply: ({ s }) => {
          s.budget += money(s, 2500)
          trust(s, 5, -3, -2)
          return 'Nowe koszulki zrobiły furorę w internecie. Zawodnicy trochę mniej.'
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
          return 'Masarnia obraziła się i przeszła do rywala zza miedzy.'
        },
      },
      {
        label: 'Klub ma honor, odmów',
        apply: ({ s }) => {
          trust(s, -8, 2, 5)
          return 'Kibice dumni. Księgowa płacze.'
        },
      },
    ],
  },
  {
    id: 'kontuzja_grill',
    player: 'any',
    text: '{p} poparzył się przy grillu na działce. Twierdzi, że „to nic”, ale ręka wygląda jak kaszanka.',
    options: [
      {
        label: 'Wyślij go do lekarza',
        apply: ({ p }) => {
          p!.injuredFor = 1
          return '{ps} pauzuje tydzień. Lekarz zabronił też grillowania, co boli bardziej.'
        },
      },
      {
        label: 'To nic, ręce w piłce niepotrzebne',
        apply: ({ p, rng }) => {
          if (p!.pos === 'BR') {
            p!.injuredFor = 3
            return 'Okazało się, że {ps} to bramkarz. Ręce jednak potrzebne. Trzy tygodnie przerwy.'
          }
          if (rng.chance(0.3)) p!.form = cl(p!.form - 2, -3, 3)
          return '{ps} gra dalej z bandażem. Wygląda groźnie, rywale się boją.'
        },
      },
    ],
  },
  {
    id: 'imprezowicz_dyskoteka',
    player: 'imprezowicz',
    text: '{p} był widziany w sobotę o 4 rano w remizie „Kosmos”. Zdjęcia krążą po grupie na Facebooku.',
    options: [
      {
        label: 'Kara finansowa i ławka',
        apply: ({ s, p }) => {
          p!.morale = cl(p!.morale - 20)
          trust(s, 3, -1, 0)
          return '{ps} odsiaduje karę na ławce. Remiza straciła stałego klienta.'
        },
      },
      {
        label: 'Udawaj, że nie widziałeś',
        apply: ({ s, rng }) => {
          if (rng.chance(0.4)) {
            scandal(s, 'Imprezowa afera w remizie „Kosmos”')
            trust(s, -8, 0, -4)
            return 'Lokalne media podchwyciły temat. Prezes pyta, czy trener w ogóle czyta Facebooka.'
          }
          trust(s, 0, 2, 0)
          return 'Sprawa ucichła. {ps} w podzięce biega za dwóch.'
        },
      },
      {
        label: 'Zrób z niego ambasadora trzeźwości',
        apply: ({ s, p, rng }) => {
          if (rng.chance(0.5)) {
            p!.traits = p!.traits.filter((t) => t !== 'imprezowicz')
            p!.traits.push('pracus')
            rep(s, 2)
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
    maxLevel: 3,
    text: 'Dziki zryły pół boiska. Mecz za cztery dni.',
    options: [
      {
        label: 'Zorganizuj czyn społeczny',
        apply: ({ s }) => {
          trust(s, 2, 3, 6)
          teamForm(s, -1)
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
          return 'Na takim boisku zostaje tylko laga. Taktyka zmieniona automatycznie.'
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
          return 'Długa rozmowa. Ustalono, że wszyscy chcą grać w ataku. Szatnia zadowolona.'
        },
      },
      {
        label: 'Tu decyduję ja',
        apply: ({ s, p }) => {
          trust(s, 2, -8, 0)
          p!.morale = cl(p!.morale - 10)
          return '{ps} wyszedł, trzaskając drzwiami. W szatni szepty.'
        },
      },
    ],
  },
  {
    id: 'agent',
    minLevel: 2,
    player: 'any',
    condition: (s) => s.squad.some((p) => p.skill > 40),
    text: 'Agent {p} dzwoni: jego klient „ma oferty z Cypru” i chce podwyżki.',
    options: [
      {
        label: 'Daj podwyżkę z budżetu transferowego',
        apply: ({ s, p }) => {
          const c = money(s, 800)
          s.budget -= c
          p!.morale = cl(p!.morale + 20)
          return `Podwyżka przyznana (${k(c)}). {ps} zadowolony, reszta szatni liczy.`
        },
      },
      {
        label: 'Sprawdź blef',
        apply: ({ p, rng }) => {
          if (rng.chance(0.65)) {
            p!.morale = cl(p!.morale - 5)
            return 'Oferta z Cypru okazała się ofertą wakacji all inclusive. {ps} zostaje.'
          }
          p!.morale = cl(p!.morale - 25)
          return '{ps} jest śmiertelnie obrażony. Gra, ale bez serca.'
        },
      },
    ],
  },
  {
    id: 'dziennikarz',
    minLevel: 3,
    text: 'Dziennikarz lokalnego portalu pyta na konferencji, czy nie boisz się zwolnienia.',
    options: [
      {
        label: '„Boję się tylko Boga i mojej żony”',
        apply: ({ s }) => {
          trust(s, 0, 2, 6)
          rep(s, 1)
          return 'Cytat dnia. Kibice drukują koszulki.'
        },
      },
      {
        label: 'Wyjdź z konferencji',
        apply: ({ s }) => {
          trust(s, -4, 0, -3)
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
    text: 'Prezes proponuje obóz przygotowawczy. Do wyboru: Zakopane albo „ośrodek u szwagra pod Grójcem”.',
    options: [
      {
        label: 'Zakopane',
        apply: ({ s }) => {
          const c = money(s, 1200)
          s.budget -= c
          teamForm(s, 1)
          return `Obóz udany. Kosztował ${k(c)}, a zawodnicy wrócili z oscypkami i formą.`
        },
      },
      {
        label: 'U szwagra',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            teamMorale(s, 6)
            return 'Ośrodek okazał się sadem jabłkowym. Treningi w rytmie zbiorów. Wszyscy zadowoleni.'
          }
          teamForm(s, -1)
          return 'Szwagier zapomniał, że obiecał też basen. Basenem był staw z rakami.'
        },
      },
    ],
  },
  {
    id: 'bramkarz_kebab',
    player: 'any',
    condition: (s) => s.squad.some((p) => p.pos === 'BR'),
    text: 'Bramkarz zamówił kebab na ławkę rezerwowych w trakcie meczu. Kamera to nagrała.',
    options: [
      {
        label: 'Ukarz go publicznie',
        apply: ({ s }) => {
          trust(s, 3, -3, 0)
          return 'Kara przyjęta. Kebab skonfiskowany przez kierownika drużyny, który go zjadł.'
        },
      },
      {
        label: 'Podpisz umowę sponsorską z kebabem',
        apply: ({ s }) => {
          s.budget += money(s, 1000)
          trust(s, 0, 4, 4)
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
          teamMorale(s, 5)
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
    text: '{p} ma propozycję testów w klubie z Bundesligi. Zgadzasz się puścić go na tydzień?',
    options: [
      {
        label: 'Puść go, niech się rozwija',
        apply: ({ s, p, rng }) => {
          p!.injuredFor = 1
          if (rng.chance(0.3)) {
            const fee = Math.round(p!.value * 2.5)
            s.budget += fee
            s.squad = s.squad.filter((x) => x.id !== p!.id)
            rep(s, 5)
            return `{ps} przeszedł testy! Klub zarabia ${k(fee)}. Ty zarabiasz reputację wychowawcy.`
          }
          p!.skill += 2
          return '{ps} wrócił z testów bez kontraktu, ale z nowymi butami i pewnością siebie.'
        },
      },
      {
        label: 'Nie, potrzebujemy go tutaj',
        apply: ({ p }) => {
          p!.morale = cl(p!.morale - 20)
          return '{ps} gra dalej u nas, ale co chwila patrzy w telefon.'
        },
      },
    ],
  },
  {
    id: 'syn_prezesa_lawka',
    player: 'syn_prezesa',
    text: 'Prezes dzwoni: „Panie trenerze, a mój syn {ps} to dlaczego tak mało gra?”.',
    options: [
      {
        label: 'Obiecaj, że zagra',
        apply: ({ s, p }) => {
          trust(s, 8, -5, 0)
          p!.morale = cl(p!.morale + 20)
          p!.form = cl(p!.form + 2, -3, 3)
          return 'Prezes zadowolony. Zawodnicy, którzy wylądują na ławce, mniej.'
        },
      },
      {
        label: 'Powiedz prawdę: jest za słaby',
        apply: ({ s, rng }) => {
          if (rng.chance(0.3)) {
            trust(s, 4, 6, 2)
            rep(s, 2)
            return 'Prezes przyznał Ci rację. Podobno sam tak myślał od lat.'
          }
          trust(s, -15, 6, 0)
          return 'Prezes rzucił słuchawką. Szatnia za to bije brawo.'
        },
      },
    ],
  },
  {
    id: 'pranie',
    maxLevel: 2,
    text: 'Pani Halinka, która od 30 lat pierze stroje, odchodzi na emeryturę. Nikt nie wie, jak działa pralka.',
    options: [
      {
        label: 'Zatrudnij następcę za klubowe pieniądze',
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
          return 'Pani Halinka odmówiła. „Panie, ja już mam wnuki do prania”.'
        },
      },
    ],
  },
  {
    id: 'wyjazd_bus',
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
          teamForm(s, -1)
          if (rng.chance(0.5)) {
            trust(s, 0, 6, 5)
            return 'Wszyscy dotarli! Bramkarz przyjechał ciągnikiem. Legenda tego meczu będzie żyła latami.'
          }
          trust(s, -3, 2, 2)
          return 'Dotarło 9 zawodników. Graliście w dziewiątkę przez pierwsze 20 minut.'
        },
      },
    ],
  },
  {
    id: 'youtuber',
    minLevel: 1,
    text: 'Znany youtuber chce nagrać odcinek „Gram w klubie z niższej ligi przez tydzień”.',
    options: [
      {
        label: 'Wpuść go do drużyny',
        apply: ({ s, rng }) => {
          s.budget += money(s, 1200)
          trust(s, 2, -3, 6)
          if (rng.chance(0.3)) {
            scandal(s, 'Youtuber w składzie meczowym')
            return 'Youtuber wszedł z ławki i dostał czerwoną kartkę po 40 sekundach. Film ma 2 mln wyświetleń.'
          }
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
    text: 'Seria słabszych wyników. Asystent proponuje dodatkowy trening w niedzielę rano.',
    condition: (s) => s.reports.slice(0, 3).filter((r) => (r.home === s.clubId ? r.hg < r.ag : r.ag < r.hg)).length >= 2,
    options: [
      {
        label: 'Tak, ciężka praca to podstawa',
        apply: ({ s }) => {
          teamForm(s, 1)
          trust(s, 3, -5, 0)
          return 'Niedzielny trening odbył się. Pół drużyny przyszło prosto z kościoła.'
        },
      },
      {
        label: 'Nie, potrzebują odpoczynku',
        apply: ({ s }) => {
          teamMorale(s, 5)
          trust(s, -2, 4, 0)
          return 'Zawodnicy wypoczęci. Prezes pyta, za co Ci płaci.'
        },
      },
      {
        label: 'Zrób grilla dla drużyny',
        apply: ({ s }) => {
          teamMorale(s, 8)
          trust(s, 0, 6, 1)
          return 'Grill integracyjny. Kiełbasa od sponsora. Jedność odbudowana.'
        },
      },
    ],
  },
  {
    id: 'sedzia_koperta',
    minLevel: 1,
    once: true,
    text: 'Tajemniczy mężczyzna w skórzanej kurtce sugeruje, że „sędzia na sobotę jest do dogadania”.',
    options: [
      {
        label: 'Wyrzuć go za drzwi',
        apply: ({ s }) => {
          rep(s, 3)
          return 'Facet wyszedł. Na odchodne rzucił: „Pan jeszcze pożałuje”. Nie pożałowałeś.'
        },
      },
      {
        label: 'Zgłoś sprawę do związku',
        apply: ({ s, rng }) => {
          rep(s, 5)
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
    minLevel: 3,
    condition: (s) => s.trust.fans < 40,
    text: 'Grupa kibiców przyszła na trening „porozmawiać” z drużyną.',
    options: [
      {
        label: 'Wyjdź do nich sam',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            trust(s, 0, 4, 10)
            return 'Rozmowa była twarda, ale uczciwa. Kibice dali drużynie kredyt zaufania.'
          }
          trust(s, -3, 0, -5)
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
        apply: ({ p }) => {
          p!.morale = cl(p!.morale + 15)
          p!.form = cl(p!.form + 1, -3, 3)
          return '{ps} uszczęśliwiony. Wykonał rożny bezpośrednio na bramkę. Prawie.'
        },
      },
      {
        label: 'Nie, są zasady',
        apply: ({ s, p }) => {
          p!.morale = cl(p!.morale - 12)
          trust(s, 0, 2, 0)
          return '{ps} obrażony. Reszta drużyny odetchnęła.'
        },
      },
    ],
  },
  {
    id: 'ksiegowa',
    minLevel: 2,
    text: 'Księgowa klubu informuje, że „pieniądze na pensje gdzieś są, tylko nie wiadomo gdzie”.',
    options: [
      {
        label: 'Przekaż część budżetu transferowego na pensje',
        apply: ({ s }) => {
          const c = Math.round(s.budget * 0.3)
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
          return 'Zawodnicy grają na kredyt. Dwóch założyło grupę „Zaległości FC”.'
        },
      },
    ],
  },
  {
    id: 'ekspert_tv',
    minLevel: 5,
    text: 'Telewizja zaprasza Cię do studia jako eksperta na mecz reprezentacji.',
    options: [
      {
        label: 'Jedź i zabłyśnij',
        apply: ({ s, rng }) => {
          if (rng.chance(0.6)) {
            rep(s, 4)
            s.coach.savings += 5000
            return 'Twoja analiza „wysokiego bloku” zrobiła wrażenie. Reputacja rośnie.'
          }
          rep(s, -2)
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
    minLevel: 2,
    text: 'Na trening przyszedł zawodnik z Brazylii. Twierdzi, że grał w młodzieżówce Santosu. Nikt tego nie może sprawdzić.',
    condition: (s) => s.squad.length < 26,
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
            goals: 0,
            apps: 0,
            value: 1000,
          })
          trust(s, 0, 0, 5)
          return good
            ? 'Brazylijczyk naprawdę umie grać! Kibice śpiewają po portugalsku. Źle, ale z sercem.'
            : 'Brazylijczyk grał w młodzieżówce Santosu, ale chyba w siatkówkę.'
        },
      },
      {
        label: 'Podziękuj',
        apply: () => 'Brazylijczyk poszedł do rywala zza miedzy. Ciekawe, co z tego będzie.',
      },
    ],
  },
  {
    id: 'stypendia_gmina',
    maxLevel: 3,
    text: 'Gmina ogłasza konkurs na dotacje dla sportu. Trzeba wypełnić 40 stron wniosku.',
    options: [
      {
        label: 'Siedź po nocach i wypełnij',
        apply: ({ s, rng }) => {
          teamForm(s, -1)
          if (rng.chance(0.6)) {
            const c = money(s, 3000)
            s.budget += c
            return `Dotacja przyznana: ${k(c)}! Zmęczenie trenera udzieliło się drużynie.`
          }
          return 'Wniosek odrzucony. Brakowało pieczątki na stronie 37.'
        },
      },
      {
        label: 'Nie ma czasu, jest liga',
        apply: () => 'Dotację dostało koło gospodyń wiejskich. Zasłużenie.',
      },
    ],
  },
  {
    id: 'szklany_powrot',
    player: 'szklany',
    text: '{p} twierdzi, że „coś go ciągnie w łydce”. Mecz jest ważny.',
    options: [
      {
        label: 'Niech odpocznie',
        apply: ({ p }) => {
          p!.injuredFor = 1
          return '{ps} odpoczywa. Ciągnie go teraz w drugiej łydce.'
        },
      },
      {
        label: 'Graj, to tylko łydka',
        apply: ({ p, rng }) => {
          if (rng.chance(0.55)) {
            p!.injuredFor = rng.int(3, 8)
            return `{ps} zerwał mięsień. Przerwa: ${p!.injuredFor} tyg. Lekarz klubowy kręci głową.`
          }
          return '{ps} zagrał i nic mu nie jest. Tym razem.'
        },
      },
    ],
  },
  {
    id: 'prezes_motywacja',
    condition: (s) => s.trust.board < 40,
    text: 'Prezes zaprasza na „poważną rozmowę” do swojej hurtowni.',
    options: [
      {
        label: 'Obiecaj wygraną w najbliższym meczu',
        apply: ({ s }) => {
          trust(s, 8, 0, 0)
          teamMorale(s, 3)
          return 'Prezes kupił obietnicę. Na razie.'
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
          return '„Ja tu widzę tylko, że przegrywamy” – podsumował prezes.'
        },
      },
      {
        label: 'Zaproponuj prezesowi miejsce na ławce',
        apply: ({ s }) => {
          trust(s, 12, -6, -2)
          scandal(s, 'Prezes na ławce trenerskiej')
          return 'Prezes siedzi na ławce w dresie. Zmiany robi sam. Klimat w szatni gęstnieje.'
        },
      },
    ],
  },
  {
    id: 'mlody_talent_wies',
    maxLevel: 4,
    condition: (s) => s.squad.length < 26,
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
            potential: skill + (great ? rng.int(20, 35) : rng.int(5, 12)),
            form: 1,
            morale: 90,
            traits: great ? ['talent'] : [],
            injuredFor: 0,
            goals: 0,
            apps: 0,
            value: 2000,
          })
          return great
            ? 'Wnuk naprawdę strzela! Dziadek ogląda każdy trening.'
            : 'Wnuk strzela głównie z lewej w trybunę. Ale ma zapał.'
        },
      },
      {
        label: 'Niech wróci za rok',
        apply: () => 'Dziadek obrażony. Wnuk zapisał się do rywala.',
      },
    ],
  },
  {
    id: 'reklama_tv',
    minLevel: 4,
    once: true,
    text: 'Firma z branży pożyczek chce, żebyś wystąpił w ich reklamie. „Szybka gotówka jak szybka kontra”.',
    options: [
      {
        label: 'Bierz kasę',
        apply: ({ s }) => {
          s.coach.savings += 20_000
          rep(s, -4)
          scandal(s, 'Reklama chwilówek z trenerem w roli głównej')
          return 'Reklama leci w każdej przerwie. Kibice śpiewają przyśpiewkę o RRSO.'
        },
      },
      {
        label: 'Odmów',
        apply: ({ s }) => {
          rep(s, 1)
          return 'Odmówiłeś. Reklamę nagrał trener rywala. Teraz to on jest memem.'
        },
      },
    ],
  },
  {
    id: 'mecz_pokazowy',
    minLevel: 2,
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
            return `Fantastyczne święto! Niestety ${p.firstName[0]}. ${p.lastName} został sfaulowany przez byłego reprezentanta. Dwa tygodnie przerwy.`
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
          teamForm(s, -1)
          return 'Obiad był pyszny. Trening przełożony. Zawodnicy nie protestowali.'
        },
      },
      {
        label: 'Trening to trening',
        apply: ({ s, rng }) => {
          trust(s, 2, 2, 0)
          if (rng.chance(0.4)) {
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
    maxLevel: 2,
    text: 'Klub ma tylko 4 piłki, w tym jedną do siatkówki.',
    options: [
      {
        label: 'Kup nowe z budżetu',
        apply: ({ s }) => {
          const c = money(s, 300)
          s.budget -= c
          teamForm(s, 1)
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
          trust(s, 0, 0, 6)
          return `Kara: ${k(c)}. Kibice kochają {ps} jeszcze bardziej.`
        },
      },
      {
        label: 'Potrąć karę z jego pensji',
        apply: ({ s, p }) => {
          p!.morale = cl(p!.morale - 15)
          trust(s, 2, -2, -8)
          return 'Kibice wywiesili transparent w obronie {ps}. I odpalili kolejną racę.'
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
            p!.skill += 2
            return '{ps} zaskoczył wszystkich i zaczął biegać. Podobno zakochał się w fizjoterapeutce.'
          }
          return '{ps} zgubił plan treningowy. Dwa razy.'
        },
      },
      {
        label: 'Odsuń go od składu',
        apply: ({ s, p }) => {
          p!.morale = cl(p!.morale - 20)
          trust(s, 2, 2, 0)
          return '{ps} odsunięty. Szatnia widzi, że zasady obowiązują wszystkich.'
        },
      },
    ],
  },
  {
    id: 'prognoza',
    text: 'Lokalna gazeta przed sezonem dała drużynie miano „murowanego kandydata do spadku”.',
    condition: (s) => s.round < 6,
    options: [
      {
        label: 'Powieś artykuł w szatni',
        apply: ({ s }) => {
          teamMorale(s, 8)
          return 'Artykuł wisi nad wejściem. Każdy zawodnik go uderza przed meczem.'
        },
      },
      {
        label: 'Zignoruj',
        apply: () => 'Zignorowałeś. Gazeta też ignoruje was do końca sezonu.',
      },
    ],
  },
  {
    id: 'sponsor_bukmacher',
    minLevel: 5,
    once: true,
    text: 'Bukmacher chce wykupić nazwę stadionu. Nowa nazwa: „Kursowo Arena”.',
    options: [
      {
        label: 'Bierzemy!',
        apply: ({ s }) => {
          s.budget += money(s, 3000)
          trust(s, 6, 0, -6)
          return '„Kursowo Arena” brzmi okropnie, ale budżet wygląda pięknie.'
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
    minLevel: 3,
    text: 'Nad boiskiem treningowym lata dron. Podobno to szpieg rywala.',
    options: [
      {
        label: 'Trenuj fałszywą taktykę',
        apply: ({ s, rng }) => {
          if (rng.chance(0.5)) {
            teamForm(s, 1)
            return 'Rywale przygotowali się na 3-4-3, a wy zagraliście swoje. Sprytne!'
          }
          teamForm(s, -1)
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
    id: 'mundial_szkolny',
    maxLevel: 3,
    text: 'Szkoła podstawowa prosi Cię o poprowadzenie zajęć WF. „Dzieci chcą trenera z prawdziwego klubu”.',
    options: [
      {
        label: 'Poprowadź zajęcia',
        apply: ({ s }) => {
          trust(s, 2, 0, 6)
          rep(s, 1)
          return 'Dzieci zachwycone. Trzech chłopaków zapisało się do akademii klubu.'
        },
      },
      {
        label: 'Nie mam czasu',
        apply: () => 'Zajęcia poprowadził katecheta. Grali w dwa ognie.',
      },
    ],
  },
]
