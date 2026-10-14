import { useEffect, useState } from 'react'
import type { Act } from '../App'
import { LEVELS, LICENSES, LICENSE_COURSES } from '../game/data'
import {
  acceptOffer,
  club,
  clubLeague,
  clubPosition,
  finishTransfers,
  formatMoney,
  goalLabel,
  licenseAllows,
  nextMatchInfo,
  playNext,
  playUntilBreak,
  resolveEvent,
  retire,
  startLicenseCourse,
  stayAtClub,
  waitForOffers,
} from '../game/engine'
import { previewStrength } from '../game/match'
import { careerScore, multiplierOf } from '../game/score'
import { wageBill } from '../game/util'
import type { GameState, JobOffer } from '../game/types'
import { CupView, MatchView, NewsView, CareerView, SquadView, TableView, TacticView, TransferView } from './panels'
import { Bar, ClubView, CoachCard } from './profiles'

type Tab = 'mecz' | 'tabela' | 'kadra' | 'taktyka' | 'transfery' | 'puchar' | 'klub' | 'wiesci' | 'kariera'

const TABS: { id: Tab; label: string }[] = [
  { id: 'mecz', label: 'Mecz' },
  { id: 'tabela', label: 'Tabela' },
  { id: 'kadra', label: 'Kadra' },
  { id: 'taktyka', label: 'Taktyka' },
  { id: 'transfery', label: 'Transfery' },
  { id: 'puchar', label: 'Puchar' },
  { id: 'klub', label: 'Klub' },
  { id: 'kariera', label: 'Trener' },
  { id: 'wiesci', label: 'Wieści' },
]

export function GameScreen({ s, act }: { s: GameState; act: Act }) {
  const [tab, setTab] = useState<Tab>('mecz')
  const team = club(s)

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
              <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
                {t.label}
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
          {s.phase === 'season' && <PlayBar s={s} act={act} />}
        </>
      )}
      {s.phase === 'event' && s.pendingEvent && <EventModal s={s} act={act} />}
    </main>
  )
}

function Header({ s }: { s: GameState }) {
  const team = club(s)
  const lg = clubLeague(s)
  // przed pierwszym meczem miejsce w tabeli nic nie znaczy
  const pos = s.round > 0 ? clubPosition(s) : undefined
  const mult = multiplierOf(s)
  return (
    <header className="hud">
      <div className="hud-cards">
        <div className="hud-card">
          <div className="hud-kicker">Trener · sezon {s.season}</div>
          <div className="coach">
            {s.coach.firstName} {s.coach.lastName}
            <span className="muted"> · {s.coach.age} l. · {s.coach.license}</span>
          </div>
          <div className="hud-stats">
            <span>Reputacja {s.coach.reputation}</span>
            <span title="Punkty kariery po mnożniku za start">
              Punkty {careerScore(s).toLocaleString('pl-PL')}
              {mult !== 1 ? ` (×${mult})` : ''}
            </span>
            <span>Oszczędności {formatMoney(s.coach.savings)}</span>
          </div>
          <Bar label="Stres" value={s.coach.stress} invert />
        </div>
        <div className="hud-card">
          <div className="hud-kicker">Klub</div>
          <div className="club">
            {team ? team.name : 'Bez klubu'}
            {lg && (
              <span className="muted">
                {' '}
                · {lg.name}
                {pos ? ` · ${pos}. miejsce` : ''}
              </span>
            )}
          </div>
          {team && (
            <>
              <div className="hud-stats">
                <span>Cel: {goalLabel(s.goal, team.level)}</span>
                <span>Budżet {formatMoney(s.budget)}</span>
                <span className={wageBill(s) > s.wageLimit ? 'warn-text' : ''}>
                  Pensje {formatMoney(wageBill(s))} / {formatMoney(s.wageLimit)}
                </span>
              </div>
              <div className="bars">
                <Bar label="Zarząd" value={s.trust.board} />
                <Bar label="Szatnia" value={s.trust.squad} />
                <Bar label="Kibice" value={s.trust.fans} />
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

function PlayBar({ s, act }: { s: GameState; act: Act }) {
  const info = nextMatchInfo(s)
  const mine = previewStrength(s)
  let label = 'Zakończ sezon'
  let oppStr: number | undefined
  if (info) {
    const f = info.league ?? info.cup!
    const home = f.home === s.clubId
    const opp = s.teams[home ? f.away : f.home]
    oppStr = opp.strength
    label = `${info.cup && !info.league ? 'Puchar: ' : ''}${home ? 'u siebie' : 'na wyjeździe'} z ${opp.name}`
  }
  return (
    <div className="playbar">
      <div className="small muted playbar-info">
        <span>
          Następny mecz: <b>{label}</b>
        </span>
        <span>
          Ty: atak {mine.att} · obrona {mine.def}
          {oppStr !== undefined && <> · rywal {oppStr}</>}
          {mine.xi.length < 11 && <b className="warn-text"> · tylko {mine.xi.length} w składzie!</b>}
        </span>
      </div>
      <div className="row">
        <button className="primary" onClick={() => act((g) => playNext(g))}>
          Rozegraj mecz
        </button>
        <button onClick={() => act((g) => playUntilBreak(g))}>Graj do przerwy</button>
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
          <button onClick={() => act((g) => startLicenseCourse(g))}>Zapisz się</button>
        </div>
      ) : (
        <p className="small">Masz najwyższą licencję. Możesz prowadzić każdy klub.</p>
      )}

      <h3>{team ? 'Oferty z innych klubów' : 'Oferty pracy'}</h3>
      <div className="offers">
        {s.offers.map((o) => (
          <OfferCard key={o.teamId} s={s} o={o} act={act} />
        ))}
      </div>
      <div className="row">
        {team && (
          <button className="primary" onClick={() => act((g) => stayAtClub(g))}>
            Zostaję w {team.name}
          </button>
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
