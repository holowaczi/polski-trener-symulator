import type { Act } from '../App'
import { FORMATIONS, STYLE_INFO, TRAITS } from '../game/data'
import {
  buyPlayer,
  club,
  clubLeague,
  computeTable,
  formatMoney,
  pickLineup,
  releasePlayer,
  retire,
  sellPlayer,
  squadRating,
} from '../game/engine'
import type { Formation, GameState, Mentality, Player, Style } from '../game/types'
import { cupRoundName, playerName } from '../game/world'

function teamName(s: GameState, id: number) {
  return s.teams[id]?.name ?? '?'
}

function Form({ v }: { v: number }) {
  const arrows = ['⇊', '↓', '↘', '→', '↗', '↑', '⇈']
  const tone = v > 0 ? 'good' : v < 0 ? 'bad' : ''
  return <span className={`form ${tone}`}>{arrows[v + 3]}</span>
}

// ---------- mecz ----------

export function MatchView({ s }: { s: GameState; act: Act }) {
  const reports = s.reports.slice(0, 8)
  if (!reports.length)
    return (
      <div>
        <h2>Przed sezonem</h2>
        <p className="muted">
          Ustaw taktykę, sprawdź kadrę i kliknij „Rozegraj mecz”. Prezes już się patrzy.
        </p>
      </div>
    )
  return (
    <div className="reports">
      {reports.map((r, i) => {
        const mine = r.home === s.clubId ? r.hg - r.ag : r.ag - r.hg
        const tone = mine > 0 ? 'win' : mine < 0 ? 'loss' : 'draw'
        return (
          <article key={i} className={`report ${tone} ${i === 0 ? 'latest' : ''}`}>
            <div className="report-head">
              <span className="small muted">{r.cup ? 'Puchar Polski' : `Kolejka ${r.round + 1}`}</span>
              <div className="score">
                <span>{teamName(s, r.home)}</span>
                <b>
                  {r.hg}:{r.ag}
                </b>
                <span>{teamName(s, r.away)}</span>
              </div>
            </div>
            {i === 0 && (
              <>
                {r.scorers.length > 0 && <div className="small">⚽ {r.scorers.join(', ')}</div>}
                <ul className="lines">
                  {r.lines.map((l, j) => (
                    <li key={j}>{l}</li>
                  ))}
                </ul>
              </>
            )}
          </article>
        )
      })}
    </div>
  )
}

// ---------- tabela ----------

export function TableView({ s }: { s: GameState }) {
  const lg = clubLeague(s)
  if (!lg) return null
  const rows = computeTable(lg)
  const size = rows.length
  return (
    <div className="scroll-x">
      <h2>{lg.name}</h2>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th className="left">Drużyna</th>
            <th>M</th>
            <th>Z</th>
            <th>R</th>
            <th>P</th>
            <th>Bramki</th>
            <th>Pkt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.teamId}
              className={[
                r.teamId === s.clubId ? 'me' : '',
                i < 2 && lg.level < 7 ? 'promo' : '',
                i >= size - 2 && lg.level > 0 ? 'releg' : '',
              ].join(' ')}
            >
              <td>{i + 1}</td>
              <td className="left">{teamName(s, r.teamId)}</td>
              <td>{r.p}</td>
              <td>{r.w}</td>
              <td>{r.d}</td>
              <td>{r.l}</td>
              <td>
                {r.gf}:{r.ga}
              </td>
              <td>
                <b>{r.pts}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Zielone: awans. Czerwone: spadek.</p>
    </div>
  )
}

// ---------- kadra ----------

function PlayerRow({ p, inXI, actions }: { p: Player; inXI: boolean; actions?: React.ReactNode }) {
  return (
    <tr className={inXI ? 'xi' : ''}>
      <td>
        <span className={`pos pos-${p.pos}`}>{p.pos}</span>
      </td>
      <td className="left">
        <div>
          {playerName(p)} {p.injuredFor > 0 && <span title="kontuzja">🩹{p.injuredFor}</span>}
        </div>
        <div className="traits">
          {p.traits.map((t) => (
            <span key={t} className="trait" title={TRAITS[t].desc}>
              {TRAITS[t].name}
            </span>
          ))}
        </div>
      </td>
      <td>{p.age}</td>
      <td>
        <b>{p.skill}</b>
      </td>
      <td className="muted">{p.potential > p.skill + 2 ? `↑${p.potential}` : '–'}</td>
      <td>
        <Form v={p.form} />
      </td>
      <td>{p.morale}</td>
      <td>
        {p.goals}/{p.apps}
      </td>
      <td className="muted">{formatMoney(p.value)}</td>
      {actions !== undefined && <td>{actions}</td>}
    </tr>
  )
}

const POS_ORDER = { BR: 0, OBR: 1, POM: 2, NAP: 3 }

export function SquadView({ s, act }: { s: GameState; act: Act }) {
  const { xi } = pickLineup(s.squad, s.tactic.formation)
  const xiIds = new Set(xi.map((p) => p.id))
  const sorted = [...s.squad].sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || b.skill - a.skill)
  return (
    <div className="scroll-x">
      <h2>Kadra ({s.squad.length})</h2>
      <p className="small muted">
        Wyróżnieni zawodnicy to pierwsza jedenastka, wybierana automatycznie według formy i umiejętności.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Poz.</th>
            <th className="left">Zawodnik</th>
            <th>Wiek</th>
            <th>Um.</th>
            <th>Pot.</th>
            <th>Forma</th>
            <th>Morale</th>
            <th>G/M</th>
            <th>Wartość</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <PlayerRow
              key={p.id}
              p={p}
              inXI={xiIds.has(p.id)}
              actions={
                <button
                  className="tiny ghost"
                  disabled={s.squad.length <= 14}
                  onClick={() => {
                    if (confirm(`Rozwiązać kontrakt z ${playerName(p)}?`)) act((g) => releasePlayer(g, p.id))
                  }}
                >
                  Zwolnij
                </button>
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- taktyka ----------

export function TacticView({ s, act }: { s: GameState; act: Act }) {
  const { rating, fit } = squadRating(s)
  const set = (patch: Partial<GameState['tactic']>) => act((g) => void Object.assign(g.tactic, patch))
  return (
    <div>
      <h2>Taktyka</h2>
      <p className="small muted">Trzy decyzje. Resztę i tak zrobi murawa.</p>
      <h3>Ustawienie</h3>
      <div className="choices">
        {(Object.keys(FORMATIONS) as Formation[]).map((f) => (
          <button key={f} className={s.tactic.formation === f ? 'choice active' : 'choice'} onClick={() => set({ formation: f })}>
            {f}
          </button>
        ))}
      </div>
      <h3>Nastawienie</h3>
      <div className="choices">
        {(['obrona', 'balans', 'atak'] as Mentality[]).map((m) => (
          <button key={m} className={s.tactic.mentality === m ? 'choice active' : 'choice'} onClick={() => set({ mentality: m })}>
            {m}
          </button>
        ))}
      </div>
      <h3>Styl gry</h3>
      <div className="choices">
        {(Object.keys(STYLE_INFO) as Style[]).map((st) => (
          <button key={st} className={s.tactic.style === st ? 'choice active' : 'choice'} onClick={() => set({ style: st })}>
            {st}
          </button>
        ))}
      </div>
      <p className="small">{STYLE_INFO[s.tactic.style]}</p>
      <div className="callout">
        <div>
          Siła składu: <b>{rating}</b>
        </div>
        <div className="small">
          Dopasowanie stylu: {fit.value > 0 ? `+${fit.value}` : fit.value}. {fit.note}
        </div>
      </div>
    </div>
  )
}

// ---------- transfery ----------

export function TransferView({ s, act }: { s: GameState; act: Act }) {
  const { xi } = pickLineup(s.squad, s.tactic.formation)
  const xiIds = new Set(xi.map((p) => p.id))
  return (
    <div className="scroll-x">
      <h2>Do kupienia</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Poz.</th>
            <th className="left">Zawodnik</th>
            <th>Wiek</th>
            <th>Um.</th>
            <th>Pot.</th>
            <th className="left">Skąd</th>
            <th>Cena</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {s.transferList.map(({ player: p, fee, from }) => (
            <tr key={p.id}>
              <td>
                <span className={`pos pos-${p.pos}`}>{p.pos}</span>
              </td>
              <td className="left">
                {playerName(p)}
                <div className="traits">
                  {p.traits.map((t) => (
                    <span key={t} className="trait" title={TRAITS[t].desc}>
                      {TRAITS[t].name}
                    </span>
                  ))}
                </div>
              </td>
              <td>{p.age}</td>
              <td>
                <b>{p.skill}</b>
              </td>
              <td className="muted">{p.potential > p.skill + 2 ? `↑${p.potential}` : '–'}</td>
              <td className="left small">{from}</td>
              <td>{fee ? formatMoney(fee) : 'za darmo'}</td>
              <td>
                <button className="tiny primary" disabled={fee > s.budget} onClick={() => act((g) => buyPlayer(g, p.id))}>
                  Kup
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!s.transferList.length && <p className="muted">Rynek pusty. Wszyscy dobrzy poszli do rywala.</p>}

      <h2>Twoja kadra ({s.squad.length})</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Poz.</th>
            <th className="left">Zawodnik</th>
            <th>Wiek</th>
            <th>Um.</th>
            <th>Pot.</th>
            <th>Forma</th>
            <th>Morale</th>
            <th>G/M</th>
            <th>Wartość</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {[...s.squad]
            .sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || b.skill - a.skill)
            .map((p) => (
              <PlayerRow
                key={p.id}
                p={p}
                inXI={xiIds.has(p.id)}
                actions={
                  <button className="tiny" disabled={s.squad.length <= 14} onClick={() => act((g) => sellPlayer(g, p.id))}>
                    Sprzedaj
                  </button>
                }
              />
            ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- puchar ----------

export function CupView({ s }: { s: GameState }) {
  const inCup = s.cup.rounds[0]?.some((t) => t.home === s.clubId || t.away === s.clubId)
  return (
    <div>
      <h2>Puchar Polski</h2>
      {!inCup && <p className="muted">W tym sezonie nie gracie w pucharze. Okręgowy związek zgubił zgłoszenie.</p>}
      {s.cup.rounds.map((round, i) => (
        <div key={i} className="cup-round">
          <h3>
            {cupRoundName(i)} <span className="small muted">(po {s.cup.schedule[i]}. tygodniu)</span>
          </h3>
          <ul className="cup-list">
            {round.map((t, j) => {
              const mine = t.home === s.clubId || t.away === s.clubId
              return (
                <li key={j} className={mine ? 'me' : ''}>
                  <span className={t.winner === t.home ? 'win-name' : ''}>{teamName(s, t.home)}</span>{' '}
                  <span className="muted small">({s.teams[t.home].level + 1})</span>{' '}
                  <b>{t.hg !== undefined ? `${t.hg}:${t.ag}` : 'vs'}</b>
                  {t.pens && <span className="small"> (k. {t.pens})</span>}{' '}
                  <span className={t.winner === t.away ? 'win-name' : ''}>{teamName(s, t.away)}</span>{' '}
                  <span className="muted small">({s.teams[t.away].level + 1})</span>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <p className="small muted">W nawiasie poziom ligi: 1 to B-klasa, 8 to Ekstraklasa. Gospodarzem jest drużyna z niższej ligi.</p>
    </div>
  )
}

// ---------- wieści ----------

export function NewsView({ s }: { s: GameState }) {
  return (
    <div>
      <h2>Wieści</h2>
      <ul className="news">
        {s.news.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  )
}

// ---------- kariera ----------

export function CareerView({ s, act }: { s: GameState; act: Act }) {
  const team = club(s)
  return (
    <div className="scroll-x">
      <h2>Kariera</h2>
      <p>
        Bilans: {s.totalStats.w}Z {s.totalStats.d}R {s.totalStats.l}P · zwolnienia: {s.totalStats.firedCount} · licencja{' '}
        {s.coach.license}
        {s.coach.courseLeft > 0 ? ' (na kursie)' : ''}
      </p>
      {s.trophies.length > 0 && (
        <>
          <h3>Trofea</h3>
          <ul>
            {s.trophies.map((t, i) => (
              <li key={i}>🏆 {t}</li>
            ))}
          </ul>
        </>
      )}
      {s.history.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Sezon</th>
              <th className="left">Klub</th>
              <th className="left">Liga</th>
              <th className="left">Wynik</th>
              <th className="left">Puchar</th>
            </tr>
          </thead>
          <tbody>
            {s.history.map((h, i) => (
              <tr key={i} className={h.fired ? 'releg' : ''}>
                <td>{h.season}</td>
                <td className="left">{h.clubName}</td>
                <td className="left">{h.leagueName}</td>
                <td className="left">{h.outcome}</td>
                <td className="left">{h.cup}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.scandals.length > 0 && (
        <>
          <h3>Afery</h3>
          <ul>
            {s.scandals.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
      <button
        className="ghost"
        onClick={() => {
          if (confirm('Na pewno kończysz karierę?'))
            act((g) => retire(g, team ? `Odszedłeś z ${team.name} w trakcie sezonu. Prezes do dziś nie wie dlaczego.` : 'Koniec.'))
        }}
      >
        Zakończ karierę
      </button>
    </div>
  )
}

