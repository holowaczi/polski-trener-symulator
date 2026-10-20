import { useEffect, useState } from 'react'
import type { Act } from '../App'
import { LEVELS, LICENSES, LICENSE_COURSES } from '../game/data'
import {
  acceptOffer,
  BOARD_PAYS_COURSE,
  boardPaysCourse,
  canTakeLeave,
  club,
  clubLeague,
  clubPosition,
  cupRoundLabel,
  playoffRoundLabel,
  finishTransfers,
  formatMoney,
  goalLabel,
  licenseAllows,
  licenseStatus,
  nextMatchInfo,
  playNext,
  resolveEvent,
  retire,
  simulateToBreak,
  startLicenseCourse,
  stayAtClub,
  takeLeave,
  waitForOffers,
} from '../game/engine'
import { previewStrength } from '../game/match'
import { careerScore, multiplierOf } from '../game/score'
import { wageBill } from '../game/util'
import type { GameState, JobOffer } from '../game/types'
import { ConfirmButton, CupView, MatchView, ReportCard, NewsView, CareerView, SquadView, TableView, TacticView, TransferView } from './panels'
import { ClubView, CoachCard } from './profiles'

type Tab = 'mecz' | 'tabela' | 'kadra' | 'taktyka' | 'transfery' | 'puchar' | 'klub' | 'wiesci' | 'kariera'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'transfery', label: 'Transfery', icon: '💸' },
  { id: 'mecz', label: 'Mecz', icon: '⚽' },
  { id: 'tabela', label: 'Tabela', icon: '📊' },
  { id: 'kadra', label: 'Kadra', icon: '👥' },
  { id: 'taktyka', label: 'Taktyka', icon: '📋' },
  { id: 'puchar', label: 'Puchar', icon: '🏆' },
  { id: 'klub', label: 'Klub', icon: '🏟️' },
  { id: 'kariera', label: 'Trener', icon: '🧢' },
  { id: 'wiesci', label: 'Wieści', icon: '📰' },
]

export function GameScreen({ s, act }: { s: GameState; act: Act }) {
  const [tab, setTab] = useState<Tab>('mecz')
  const [auto, setAuto] = useState<AutoState>({ speed: 1, running: false })
  const team = club(s)
  // ostatni mecz przed oknem, końcem sezonu albo zwolnieniem: pokazujemy go, zanim gra pójdzie dalej
  const [seenSeq, setSeenSeq] = useState(() => s.lastReport?.seq ?? 0)
  const lastSeq = s.lastReport?.seq ?? 0
  const inSeason = s.phase === 'season' || s.phase === 'event'
  useEffect(() => {
    if (inSeason && lastSeq > seenSeq) setSeenSeq(lastSeq)
  }, [inSeason, lastSeq, seenSeq])
  const showLast = !inSeason && lastSeq > seenSeq && !!s.lastReport

  // tryb automatyczny: kolejny mecz po chwili; zdarzenie czeka na decyzję, okno, koniec sezonu i zwolnienie zatrzymują
  useEffect(() => {
    if (!auto.running) return
    if (s.phase === 'event') return
    if (s.phase !== 'season') {
      setAuto((a) => ({ ...a, running: false }))
      return
    }
    const t = setTimeout(() => act((g) => playNext(g)), SPEEDS[auto.speed].ms)
    return () => clearTimeout(t)
  }, [auto, s, act])

  useEffect(() => {
    if (s.phase === 'transfer') setTab('transfery')
    else if (s.phase === 'season') setTab((t) => (t === 'transfery' ? 'mecz' : t))
  }, [s.phase])

  return (
    <main className="game">
      <Header s={s} />
      {s.phase === 'hiring' && <HiringView s={s} act={act} />}
      {s.phase === 'seasonEnd' && <SeasonEndView s={s} act={act} />}
      {team && (s.phase === 'season' || s.phase === 'transfer' || s.phase === 'event') && (
        <>
          <nav className="tabs" aria-label="Sekcje">
            {TABS.filter((t) => t.id !== 'transfery' || s.phase === 'transfer').map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? 'tab active' : 'tab'}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={(e) => {
                  setTab(t.id)
                  // po zmianie zakładki zaczynamy od góry treści, a nie w połowie poprzedniej listy
                  const nav = e.currentTarget.parentElement!
                  const top = nav.getBoundingClientRect().top + window.scrollY - 4
                  if (window.scrollY > top) window.scrollTo({ top })
                  e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
                }}
              >
                <span aria-hidden="true">{t.icon}</span> {t.label}
              </button>
            ))}
          </nav>
          {s.phase === 'transfer' && (
            <div className="banner">
              <span>
                Okno transferowe otwarte. Budżet: <b>{formatMoney(s.budget)}</b>
              </span>
              <button className="primary" onClick={() => act((g) => finishTransfers(g))}>
                Zamknij okno i graj
              </button>
            </div>
          )}
          <section className="panel">
            {tab === 'mecz' && <MatchView s={s} act={act} />}
            {tab === 'tabela' && <TableView s={s} />}
            {tab === 'kadra' && <SquadView s={s} act={act} />}
            {tab === 'taktyka' && <TacticView s={s} act={act} />}
            {tab === 'transfery' && <TransferView s={s} act={act} />}
            {tab === 'puchar' && <CupView s={s} />}
            {tab === 'wiesci' && <NewsView s={s} />}
            {tab === 'klub' && <ClubView s={s} act={act} />}
            {tab === 'kariera' && (
              <>
                <CoachCard s={s} />
                <CareerView s={s} act={act} />
              </>
            )}
          </section>
          {s.phase === 'season' && <PlayBar s={s} act={act} auto={auto} setAuto={setAuto} />}
        </>
      )}
      {s.phase === 'event' && s.pendingEvent && <EventModal s={s} act={act} />}
      {showLast && (
        <div className="modal-bg">
          <div className="modal last-match" role="dialog" aria-modal="true">
            <div className="modal-tag">
              Ostatni mecz {s.phase === 'transfer' ? 'przed oknem transferowym' : s.phase === 'seasonEnd' ? 'sezonu' : s.phase === 'hiring' ? 'w klubie' : ''}
            </div>
            <ReportCard s={s} r={s.lastReport!} latest />
            <div className="options">
              <button className="primary" onClick={() => setSeenSeq(lastSeq)}>
                {s.phase === 'transfer' ? 'Do okna transferowego' : s.phase === 'seasonEnd' ? 'Do podsumowania sezonu' : 'Dalej'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

/** mały licznik 0–100: nazwa i wartość nad cienkim paskiem */
function Meter({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const v = invert ? 100 - value : value
  const tone = v < 25 ? 'bad' : v < 50 ? 'warn' : 'good'
  return (
    <div className="meter" title={`${label}: ${value}/100`}>
      <div className="meter-top">
        <span>{label}</span>
        <b className={tone === 'good' ? '' : `${tone}-text`}>{value}</b>
      </div>
      <span className="bar-track">
        <span className={`bar-fill ${tone}`} style={{ width: `${value}%` }} />
      </span>
    </div>
  )
}

function Header({ s }: { s: GameState }) {
  const team = club(s)
  const lg = clubLeague(s)
  // przed pierwszym meczem miejsce w tabeli nic nie znaczy
  const pos = s.round > 0 ? clubPosition(s) : undefined
  const mult = multiplierOf(s)
  const overWages = wageBill(s) > s.wageLimit
  const lic = licenseStatus(s)
  return (
    <header className="hud">
      <div className="hud-top">
        <div className="hud-club">
          <div className="hud-kicker">
            Sezon {s.season}
            {team && s.round > 0 ? ` · kolejka ${s.round}` : ''}
          </div>
          <div className="club">
            {team ? team.name : 'Bez klubu'}
            {pos && <span className="pos-badge">{pos}.</span>}
          </div>
          {lg && <div className="small muted">{lg.name}{team ? ` · cel: ${goalLabel(s.goal, team.level).toLowerCase()}` : ''}</div>}
        </div>
        <div className="hud-coach">
          <div className="coach">
            {s.coach.firstName} {s.coach.lastName}
          </div>
          <div className="small muted">
            {lic && !lic.ok ? (
              <span className="warn-text" title={lic.studying ? 'Zgoda warunkowa: jesteś na kursie' : 'Klub zgłosił trenera z licencją na papierze'}>
                {s.coach.license} (liga wymaga {lic.need})
              </span>
            ) : (
              s.coach.license
            )}{' '}
            · rep. {s.coach.reputation} ·{' '}
            <span title="Punkty kariery po mnożniku za start">
              {careerScore(s).toLocaleString('pl-PL')} pkt{mult !== 1 ? ` (×${mult})` : ''}
            </span>
          </div>
        </div>
      </div>
      {team && (
        <div className="hud-money small">
          <span>💰 {formatMoney(s.budget)}</span>
          <span className={overWages ? 'warn-text' : ''}>
            Pensje {formatMoney(wageBill(s))} / {formatMoney(s.wageLimit)}
          </span>
          <span className="muted">Oszczędności {formatMoney(s.coach.savings)}</span>
        </div>
      )}
      <div className="meters">
        {team && <Meter label="Zarząd" value={s.trust.board} />}
        {team && <Meter label="Szatnia" value={s.trust.squad} />}
        {team && <Meter label="Kibice" value={s.trust.fans} />}
        <Meter label="Stres" value={s.coach.stress} invert />
      </div>
    </header>
  )
}

type AutoState = { speed: number; running: boolean }

const SPEEDS = [
  { label: 'Wolno', short: '1×', ms: 3000 },
  { label: 'Normalnie', short: '2×', ms: 1500 },
  { label: 'Szybko', short: '3×', ms: 500 },
]

function PlayBar({ s, act, auto, setAuto }: { s: GameState; act: Act; auto: AutoState; setAuto: (a: AutoState) => void }) {
  const info = nextMatchInfo(s)
  const mine = previewStrength(s)
  let label = 'Koniec sezonu'
  let oppStr: number | undefined
  const vs = (f: { home: number; away: number }) => `${f.home === s.clubId ? 'u siebie' : 'wyjazd'}: ${s.teams[f.home === s.clubId ? f.away : f.home].name}`
  const isCup = !!info?.cup
  const isPlayoff = !!info?.playoff
  if (info) {
    const f = info.league ?? info.cup ?? info.playoff!
    oppStr = s.teams[f.home === s.clubId ? f.away : f.home].strength
    label = vs(f)
  }
  const comp = !info
    ? undefined
    : isPlayoff
      ? `⚔️ ${playoffRoundLabel(s, info.week) ?? 'Baraże'}`
      : isCup
        ? `🏆 ${cupRoundLabel(s, info.week) ?? 'Puchar'}`
        : 'Liga'
  const myStr = Math.round(((mine.att + mine.def) / 2) * 10) / 10
  const speed = SPEEDS[auto.speed]
  return (
    <div className="playbar">
      <div className="playbar-info small">
        <span className="playbar-next">
          {comp && <span className={`comp-tag ${isPlayoff ? 'playoff' : isCup ? 'cup' : ''}`}>{comp}</span>} <b>{label}</b>
        </span>

        <span className="playbar-str muted" title={`Ty: atak ${mine.att}, obrona ${mine.def}`}>
          {oppStr !== undefined ? (
            <>
              siła <b className={myStr >= oppStr ? 'good-text' : 'warn-text'}>{myStr}</b> vs {oppStr}
            </>
          ) : null}
          {mine.xi.length < 11 && <b className="warn-text"> · tylko {mine.xi.length} w składzie!</b>}
        </span>
      </div>
      <div className="playbar-controls">
        {auto.running ? (
          <button className="primary play" onClick={() => setAuto({ ...auto, running: false })}>
            ⏸ Pauza
          </button>
        ) : (
          <button className="primary play" onClick={() => act((g) => playNext(g))}>
            Rozegraj mecz
          </button>
        )}
        <button
          className={auto.running ? 'active' : ''}
          aria-pressed={auto.running}
          title="Graj automatycznie: zatrzyma się przy zdarzeniu, oknie transferowym, końcu sezonu albo zwolnieniu"
          onClick={() => setAuto({ ...auto, running: !auto.running })}
        >
          {auto.running ? '⏸' : '▶'}
          <span className="lbl"> Auto</span>
        </button>
        <button
          title={`Tempo trybu automatycznego: ${speed.label.toLowerCase()} (kliknij, żeby zmienić)`}
          aria-label={`Tempo: ${speed.label}`}
          onClick={() => setAuto({ ...auto, speed: (auto.speed + 1) % SPEEDS.length })}
        >
          <span className="lbl">Tempo </span>
          {speed.short}
        </button>
        <ConfirmButton
          label="⏩ Do okna"
          confirmLabel="Na pewno?"
          title="Symuluj do okna transferowego, końca sezonu albo zwolnienia. Zdarzenia rozstrzygnie asystent."
          onConfirm={() => {
            setAuto({ ...auto, running: false })
            act((g) => simulateToBreak(g))
          }}
        />
      </div>
    </div>
  )
}

function EventModal({ s, act }: { s: GameState; act: Act }) {
  const ev = s.pendingEvent!
  return (
    <div className="modal-bg">
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-tag">Zdarzenie</div>
        <p className="event-text">{ev.text}</p>
        <div className="options">
          {ev.options.map((o, i) => (
            <button key={i} onClick={() => act((g) => resolveEvent(g, i))}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function OfferCard({ s, o, act }: { s: GameState; o: JobOffer; act: Act }) {
  const allowed = licenseAllows(s, o.level)
  return (
    <div className="offer">
      <div className="offer-head">
        <b>{o.teamName}</b>
        <span className="pill">{o.leagueName}</span>
      </div>
      <dl className="offer-facts small">
        <dt>Cel</dt>
        <dd>{goalLabel(o.goal, o.level)}</dd>
        <dt>Pensja</dt>
        <dd>{formatMoney(o.salary)} za sezon</dd>
      </dl>
      <p className="small muted">{o.note}</p>
      <button className="primary" disabled={!allowed} onClick={() => act((g) => acceptOffer(g, o.teamId))}>
        {allowed ? 'Biorę tę robotę' : `Wymaga ${LEVELS[o.level].license}`}
      </button>
    </div>
  )
}

function HiringView({ s, act }: { s: GameState; act: Act }) {
  const midSeason = s.round > 0
  return (
    <section className="panel">
      <h2>Szukasz pracy</h2>
      {s.hiringNote && <p>{s.hiringNote}</p>}
      <div className="offers">
        {s.offers.map((o) => (
          <OfferCard key={o.teamId} s={s} o={o} act={act} />
        ))}
      </div>
      <div className="row">
        {midSeason && <button onClick={() => act((g) => waitForOffers(g))}>Przeczekaj do końca sezonu</button>}
        <button
          className="ghost"
          onClick={() => act((g) => retire(g, 'Zostałeś ekspertem w telewizji. Krawat zamiast dresu.'))}
        >
          Kończę karierę
        </button>
      </div>
    </section>
  )
}

function SeasonEndView({ s, act }: { s: GameState; act: Act }) {
  const team = club(s)
  const next = LICENSES[LICENSES.indexOf(s.coach.license) + 1]
  const course = next ? LICENSE_COURSES[next] : undefined
  const lic = licenseStatus(s)
  return (
    <section className="panel">
      <h2>Koniec sezonu {s.season - 1}</h2>
      <ul className="summary">
        {(s.lastSeasonSummary ?? []).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>

      {!team && s.hiringNote && <p className="warn-text">{s.hiringNote}</p>}

      <h3>Licencja trenerska</h3>
      {s.coach.courseLeft > 0 ? (
        <p className="small">Jesteś na kursie {next}. Dyplom po {s.coach.courseLeft === 1 ? 'kolejnym sezonie' : `${s.coach.courseLeft} sezonach`}.</p>
      ) : next && course ? (
        <div className="row">
          <span className="small">
            Kurs {next}: {formatMoney(course.cost)}, wymagana reputacja {course.rep}.
          </span>
          {boardPaysCourse(s) ? (
            <button className="primary" onClick={() => act((g) => startLicenseCourse(g, true))}>
              Zapisz się na koszt klubu
            </button>
          ) : (
            <button onClick={() => act((g) => startLicenseCourse(g))}>Zapisz się</button>
          )}
        </div>
      ) : (
        <p className="small">Masz najwyższą licencję. Możesz prowadzić każdy klub.</p>
      )}
      {lic && !lic.ok && (
        <div className={`callout ${lic.canStay ? '' : 'callout-bad'}`}>
          {lic.studying ? (
            <>
              Nowa liga wymaga licencji <b>{lic.need}</b>. Jesteś na kursie, więc związek da zgodę warunkową.
            </>
          ) : lic.canStay ? (
            <>
              Nowa liga wymaga licencji <b>{lic.need}</b>, a Ty masz {s.coach.license}. Zapisz się na kurs albo klub zgłosi trenera z licencją „na papierze”
              za {formatMoney(lic.cost)} z budżetu, a zarząd będzie niezadowolony. Taki numer przejdzie tylko raz.{' '}
              {boardPaysCourse(s)
                ? 'Prezes jest zadowolony z awansu i zapłaci za Twój kurs.'
                : `Przy lepszych relacjach z zarządem (${BOARD_PAYS_COURSE}+, teraz ${s.trust.board}) klub zapłaciłby za kurs.`}
            </>
          ) : (
            <>
              Związek nie zgodzi się na kolejny sezon z trenerem „na papierze”. Żeby zostać, zapisz się na kurs {next}. Możesz też przyjąć ofertę z innego klubu.
              {boardPaysCourse(s) ? ' Prezes zapłaci za kurs.' : ''}
            </>
          )}
        </div>
      )}

      <h3>{team ? 'Oferty z innych klubów' : 'Oferty pracy'}</h3>
      <div className="offers">
        {s.offers.map((o) => (
          <OfferCard key={o.teamId} s={s} o={o} act={act} />
        ))}
      </div>
      <div className="row">
        {team && (
          <button className="primary" disabled={lic && !lic.canStay} onClick={() => act((g) => stayAtClub(g))}>
            Zostaję w {team.name}
          </button>
        )}
        {!team && (
          <ConfirmButton
            label="Czekam na lepsze oferty"
            confirmLabel="Cały sezon bez pracy?"
            title="Sezon bez klubu. Reputacja trochę spada, a po długiej przerwie telefon może zamilknąć na dobre."
            onConfirm={() => act((g) => waitForOffers(g))}
          />
        )}
        {team && canTakeLeave(s) && (
          <ConfirmButton
            label="🏖️ Biorę urlop na sezon"
            confirmLabel="Na pewno sezon przerwy?"
            title="Sezon odpoczynku: stres i wypalenie znikają, reputacja spada. Odchodzisz z klubu."
            onConfirm={() => act((g) => takeLeave(g))}
          />
        )}
        <button
          className="ghost"
          onClick={() => act((g) => retire(g, 'Odwiesiłeś gwizdek na kołek. Pora na działkę i Canal+.'))}
        >
          Kończę karierę
        </button>
      </div>
    </section>
  )
}
