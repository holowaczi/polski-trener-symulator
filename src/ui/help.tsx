import { useEffect, useState } from 'react'

// ---------- podpowiedzi dla nowego gracza ----------

export type TipId = 'hiring' | 'firstMatch' | 'meters' | 'event' | 'transfer' | 'seasonEnd'

const TIPS: Record<TipId, { title: string; text: string }> = {
  hiring: {
    title: 'Pierwsza robota',
    text: 'Na początek dzwonią kluby z samego dołu. Każda oferta ma cel na sezon: spełnisz go, to rośnie reputacja i dzwonią lepsze kluby. Wyższe ligi wymagają wyższej licencji UEFA, a kurs zapiszesz po sezonie.',
  },
  firstMatch: {
    title: 'Jak się gra mecz',
    text: 'Na dolnym pasku „Rozegraj mecz” gra jeden mecz, ▶ gra po kolei sam, a ⏩ przewija do okna transferowego albo końca sezonu. Skład ułoży asystent, ale w zakładkach Kadra i Taktyka możesz go poprawić. Siła na pasku to Ty kontra rywal.',
  },
  meters: {
    title: 'Liczniki na górze',
    text: 'Zarząd za nisko to zwolnienie (zwykle poniżej 12, ale niecierpliwy prezes wylewa szybciej), chyba że jesteś w czołówce tabeli. Szatnia poniżej 15 to bunt i gorsza gra, a kibice poniżej 15 psują humor prezesowi. Stres rośnie po porażkach i złych decyzjach, a długo trzymany wysoko kończy się u lekarza.',
  },
  event: {
    title: 'Zdarzenie',
    text: 'Między meczami dzieje się życie: prezes, zawodnicy, kibice, media. Wybierz jedną odpowiedź. Skutki zobaczysz w licznikach i w Wieściach. Afery i niespełnione obietnice zbierają się w teczce dziennikarza, więc nie obiecuj wszystkiego wszystkim.',
  },
  transfer: {
    title: 'Okno transferowe',
    text: 'Tu kupujesz, sprzedajesz i przedłużasz umowy. Pilnuj limitu pensji i liczby nowych zawodników (latem 4, zimą 2). Przy każdym kandydacie widać, czy wszedłby do składu. Gdy skończysz, kliknij „Zamknij okno i graj”.',
  },
  seasonEnd: {
    title: 'Koniec sezonu',
    text: 'Zarząd ocenia, czy spełniłeś cel. Możesz zostać, przyjąć ofertę z innego klubu albo zapisać się na kurs licencji, jeśli masz reputację i pieniądze. Wyższa licencja otwiera wyższe ligi.',
  },
}

const TIPS_KEY = 'pts-tips'
const TIPS_EVENT = 'pts-tips-change'

interface TipsState {
  off: boolean
  seen: TipId[]
}

function readTips(): TipsState {
  try {
    const raw = localStorage.getItem(TIPS_KEY)
    if (raw) return { off: false, seen: [], ...(JSON.parse(raw) as Partial<TipsState>) }
  } catch {
    // brak dostępu do pamięci: podpowiedzi po prostu pokazują się od nowa
  }
  return { off: false, seen: [] }
}

function writeTips(t: TipsState): void {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify(t))
  } catch {
    // jw.
  }
  window.dispatchEvent(new Event(TIPS_EVENT))
}

export function useTips(): [TipsState, (t: TipsState) => void] {
  const [tips, setTips] = useState(readTips)
  useEffect(() => {
    const sync = () => setTips(readTips())
    window.addEventListener(TIPS_EVENT, sync)
    return () => window.removeEventListener(TIPS_EVENT, sync)
  }, [])
  return [tips, writeTips]
}

/** jednorazowa podpowiedź: znika po „Rozumiem” albo po wyłączeniu wszystkich */
export function Tip({ id }: { id: TipId }) {
  const [tips, setTips] = useTips()
  if (tips.off || tips.seen.includes(id)) return null
  const tip = TIPS[id]
  return (
    <aside className="tip" aria-label="Podpowiedź">
      <div className="tip-title">💡 {tip.title}</div>
      <p>{tip.text}</p>
      <div className="row">
        <button className="tiny primary" onClick={() => setTips({ ...tips, seen: [...tips.seen, id] })}>
          Rozumiem
        </button>
        <button className="tiny ghost" onClick={() => setTips({ ...tips, off: true })}>
          Wyłącz podpowiedzi
        </button>
      </div>
    </aside>
  )
}

/** przełącznik w „Jak grać”: włącza podpowiedzi z powrotem od początku */
function TipsToggle() {
  const [tips, setTips] = useTips()
  const active = !tips.off && tips.seen.length < Object.keys(TIPS).length
  return (
    <p className="small">
      Podpowiedzi dla nowego trenera: <b>{active ? 'włączone' : 'wyłączone'}</b>{' '}
      <button className="tiny" onClick={() => setTips(active ? { ...tips, off: true } : { off: false, seen: [] })}>
        {active ? 'Wyłącz' : 'Pokaż od nowa'}
      </button>
    </p>
  )
}

// ---------- „Jak grać” ----------

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'O co chodzi',
    body: [
      'Jesteś trenerem bez nazwiska. Zaczynasz w najniższej klasie swojego województwa i próbujesz dojść jak najwyżej: Ekstraklasa, Puchar Polski, Europa. Albo przynajmniej nie skończyć w sklepie wędkarskim.',
      'Kariera kończy się emeryturą, Twoją decyzją, wypaleniem, aferą w gazecie albo zbyt długim bezrobociem. Na koniec dostajesz kartę trenera z punktami, trofeami i cytatem z prasy.',
    ],
  },
  {
    title: 'Sezon krok po kroku',
    body: [
      'Przed sezonem i w przerwie zimowej otwiera się okno transferowe. Potem grasz mecz po meczu: liga, puchar, czasem baraże i Europa. Między meczami wpadają zdarzenia, na które trzeba odpowiedzieć.',
      'Po ostatniej kolejce zarząd rozlicza Cię z celu. Spełniony cel to reputacja, lepsze oferty i spokój. Niespełniony to nerwowy prezes, a czasem szukanie nowej pracy.',
    ],
  },
  {
    title: 'Liczniki: Zarząd, Szatnia, Kibice, Stres',
    body: [
      'Zarząd to cierpliwość prezesa. Spada po porażkach, łataniu dziur w budżecie i złych decyzjach. Zwykle poniżej 12 jesteś zwolniony (próg zależy od prezesa, zobaczysz go w zakładce Klub), chyba że drużyna jest w czołowej jednej trzeciej tabeli.',
      'Szatnia to humor piłkarzy i wpływa na siłę drużyny. Poniżej 15 zaczyna się bunt i gra „na trenera”. Kibice poniżej 15 wieszają transparenty i dokładają nerwów prezesowi.',
      'Stres rośnie po porażkach i ciężkich zdarzeniach. Długo trzymany bardzo wysoko zbiera wypalenie (widać je w zakładce Trener). Wtedy pomaga urlop albo sanatorium, a ignorowanie lekarza kończy karierę.',
    ],
  },
  {
    title: 'Prezes, rywal, ulubieniec i przemowa',
    body: [
      'Każdy klub ma prezesa z charakterem: biznesmen szybko traci cierpliwość, ale daje na transfery, samorządowiec jest cierpliwy i słucha kibiców, były piłkarz przeżywa każdy wynik, a przedsiębiorca z masarnią płaci za kiełbasę. Opis znajdziesz w zakładce Klub.',
      'Klub ma też rywala zza miedzy. Derby mocniej ruszają kibicami, zarządem i Twoimi nerwami, a gazety piszą o nich grubszą czcionką.',
      'Co sezon szatnia wybiera ulubieńca (💛 w Kadrze). Posadzisz go na dłużej na ławce, szatnia się upomni. Sprzedasz go, będzie żałoba.',
      'Nad listą meczów wybierasz przemowę w przerwie: „Spokojnie, panowie” pomaga dowieźć prowadzenie, wściekłość pomaga odrabiać straty, a kiełbasa po meczu poprawia humor szatni. Domyślnie decyduje asystent.',
    ],
  },
  {
    title: 'Licencje i reputacja',
    body: [
      'Każda liga wymaga licencji: klasy A i okręgówka UEFA C, IV i III liga UEFA B, II i I liga UEFA A, Ekstraklasa UEFA Pro. Kurs na kolejną licencję zapisujesz po sezonie. Kosztuje pieniądze z Twoich oszczędności i wymaga reputacji.',
      'Gdy awansujesz do ligi, która wymaga wyższej licencji, klub czasem zapłaci za kurs. Jak nie, przez sezon zgłasza trenera „na papierze”, a Ty oficjalnie jesteś asystentem.',
      'Reputacja rośnie za spełnione cele, awanse i trofea. Od niej zależy, kto dzwoni z ofertą.',
    ],
  },
  {
    title: 'Kadra, transfery i pieniądze',
    body: [
      'Skład ustawia asystent, ale możesz go zmienić w Kadrze, a formację i styl gry w Taktyce. Kontuzje, kartki i zawieszenia potrafią przetrzebić skład w najgorszym momencie.',
      'W oknie transferowym pilnuj budżetu i limitu pensji. Latem możesz sprowadzić 4 nowych, zimą 2. Kończące się umowy przedłużasz w części „Umowy”. Budżet nie spada poniżej zera, ale jak prezes łata dziurę, to to zapamiętuje.',
      'W zakładce Klub poprosisz prezesa o pieniądze na transfery albo większy limit pensji. Lepiej prosić po serii zwycięstw niż po trzech porażkach.',
    ],
  },
  {
    title: 'Punkty kariery',
    body: [
      'Punkty dostajesz za sezony (im wyższa liga, tym więcej), mistrzostwa, awanse, puchary, Europę, zwycięstwa i najwyższy szczebel kariery. Spadki odejmują.',
      'Wynik mnoży się przez mnożnik startu: klasyczny start z UEFA C i ofertami z dołu to ×1, a łatwiejszy start (wyższa licencja, wybrany klub) daje mniej. Najlepsze kariery trafiają do rekordów na ekranie startowym.',
      '„Wyzwanie dnia” to ten sam świat dla wszystkich tego dnia. Porównaj wynik ze znajomymi.',
    ],
  },
  {
    title: 'Wyzwania i odznaki',
    body: [
      'Na ekranie startowym są wyzwania: gotowe starty z jednym celem, np. utrzymać beniaminka Ekstraklasy albo uratować klub z I ligi w 10 kolejek. Wynik trafia do kolekcji na tym urządzeniu, a kariera po wyzwaniu toczy się dalej.',
      'Odznaki zbierasz za rzeczy, którymi warto się pochwalić: awans z klasy C, 5:0 w derbach, trzech prezesów. Lądują na karcie trenera i na ekranie startowym.',
    ],
  },
  {
    title: 'Zapis gry',
    body: [
      'Gra zapisuje się sama w przeglądarce. Kopię kariery w pliku pobierzesz w zakładce Trener i wczytasz na ekranie startowym, np. na innym telefonie.',
    ],
  },
]

export function HowToPlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal help" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2 id="help-title">Jak grać</h2>
          <button className="ghost" onClick={onClose} aria-label="Zamknij">
            ✕
          </button>
        </div>
        {SECTIONS.map((sec, i) => (
          <details key={sec.title} open={i === 0}>
            <summary>{sec.title}</summary>
            {sec.body.map((p, j) => (
              <p key={j}>{p}</p>
            ))}
          </details>
        ))}
        <TipsToggle />
        <button className="primary" onClick={onClose}>
          Do roboty
        </button>
      </div>
    </div>
  )
}
