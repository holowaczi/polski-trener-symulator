import { useEffect, useState } from 'react'
import type { Act } from '../App'
import { FORMATIONS, STYLE_INFO, TRAITS } from '../game/data'
import { club, clubLeague, computeTable, formatMoney, retire, setAutoLineup, setPlayerSlot, type SlotState } from '../game/engine'
import { acceptBid, buyPlayer, counterBid, MAX_SQUAD, MIN_SQUAD, rejectBid, releasePlayer, sellPlayer } from '../game/market'
import { formationOf, previewStrength, teamBonus } from '../game/match'
import type { Formation, GameState, Mentality, Player, Style } from '../game/types'
import { avgRating, wageBill } from '../game/util'
import { cupRoundName, playerName } from '../game/world'

/** dwuetapowe potwierdzenie w samym przycisku, bez okienek przeglądarki */
function ConfirmButton(props: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  className?: string
  disabled?: boolean
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      className={`${props.className ?? ''}${armed ? ' danger' : ''}`}
      disabled={props.disabled}
      onClick={() => (armed ? props.onConfirm() : setArmed(true))}
    >
      {armed ? props.confirmLabel : props.label}
    </button>
  )
}

function teamName(s: GameState, id: number) {
  return s.teams[id]?.name ?? '?'
}

function Form({ v }: { v: number }) {
  const arrows = ['⇊', '↓', '↘', '→', '↗', '↑', '⇈']
  const tone = v > 0 ? 'good' : v < 0 ? 'bad' : ''
  return (
    <span className={`form ${tone}`} title={`Forma ${v > 0 ? '+' : ''}${v}`}>
      {arrows[v + 3]}
    </span>
  )
}

export function Rating({ r }: { r?: number }) {
  if (r === undefined) return <span className="muted">–</span>
  const tone = r >= 7.5 ? 'r-hi' : r < 5.5 ? 'r-lo' : 'r-mid'
  return <span className={`rating ${tone}`}>{r.toFixed(1)}</span>
}

function Status({ p }: { p: Player }) {
  if (p.injuredFor > 0)
    return (
      <span className="chip bad" title="kontuzja">
        🩹 {p.injuredFor} m.
      </span>
    )
  if (p.suspendedFor > 0)
    return (
      <span className="chip bad" title="zawieszenie">
        🟥 {p.suspendedFor} m.
      </span>
    )
  return null
}

function Traits({ p }: { p: Player }) {
  if (!p.traits.length) return null
  return (
    <div className="traits">
      {p.traits.map((t) => (
        <span key={t} className="trait" title={TRAITS[t].desc}>
          {TRAITS[t].name}
        </span>
      ))}
    </div>
  )
}

const POS_ORDER = { BR: 0, OBR: 1, POM: 2, NAP: 3 }
const byPos = (a: Player, b: Player) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || b.skill - a.skill

// ---------- mecz ----------

export function MatchView({ s }: { s: GameState; act: Act }) {
  const reports = s.reports.slice(0, 8)
  const bonus = teamBonus(s, previewStrength(s).xi)
  return (
    <div className="reports">
      {s.modifiers.length > 0 && (
        <div className="chips" aria-label="Aktywne efekty">
          {s.modifiers.map((m) => (
            <span key={m.label} className={`chip ${m.amount >= 0 ? 'good' : 'bad'}`}>
              {m.label}: {m.amount > 0 ? '+' : ''}
              {m.amount} ({m.matches} m.)
            </span>
          ))}
        </div>
      )}
      {!reports.length && (
        <div>
          <h2>Przed meczem</h2>
          <p className="muted">
            Ustaw skład w zakładce Kadra, taktykę w zakładce Taktyka i kliknij „Rozegraj mecz”. Wynik zależy od ocen
            zawodników w danym dniu, ustawienia i atmosfery.
          </p>
          <ul className="small">
            {bonus.parts.map((p) => (
              <li key={p.label}>
                {p.label}: {p.value > 0 ? '+' : ''}
                {p.value}
              </li>
            ))}
          </ul>
        </div>
      )}
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
                <div className="small muted">
                  Siła: atak {r.myStrength.att}, obrona {r.myStrength.def} · rywal {r.oppStrength}
                </div>
                <ul className="match-events">
                  {r.events.map((e, j) => (
                    <li key={j}>{e}</li>
                  ))}
                </ul>
                <ul className="lines">
                  {r.lines.map((l, j) => (
                    <li key={j}>{l}</li>
                  ))}
                </ul>
                <div className="ratings-grid" aria-label="Oceny zawodników">
                  {r.ratings.map((x) => (
                    <div key={x.id}>
                      <span>
                        <span className={`pos pos-${x.pos}`}>{x.pos}</span> {x.name}
                        {x.sub ? ' ↑' : ''}
                      </span>
                      <Rating r={x.rating} />
                    </div>
                  ))}
                </div>
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
                i < (lg.level >= 5 ? 3 : 2) && lg.level < 7 ? 'promo' : '',
                i >= size - (lg.level >= 6 ? 3 : 2) && lg.level > 0 ? 'releg' : '',
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
      <p className="small muted">Zielone: awans (z barażami w uproszczeniu). Czerwone: spadek.</p>
    </div>
  )
}

// ---------- kadra i skład ----------

function SlotPicker({ s, p, act }: { s: GameState; p: Player; act: Act }) {
  const { xi, bench } = previewStrength(s)
  const cur: SlotState = xi.some((x) => x.id === p.id) ? 'xi' : bench.some((x) => x.id === p.id) ? 'bench' : 'out'
  const opts: [SlotState, string][] = [
    ['xi', 'XI'],
    ['bench', 'Ł'],
    ['out', '–'],
  ]
  return (
    <span className="slot" role="group" aria-label={`Miejsce: ${playerName(p)}`}>
      {opts.map(([v, l]) => (
        <button
          key={v}
          className={cur === v ? 'on' : ''}
          aria-pressed={cur === v}
          title={v === 'xi' ? 'Pierwszy skład' : v === 'bench' ? 'Ławka rezerwowych' : 'Poza kadrą meczową'}
          onClick={() => cur !== v && act((g) => setPlayerSlot(g, p.id, v))}
        >
          {l}
        </button>
      ))}
    </span>
  )
}

export function SquadView({ s, act }: { s: GameState; act: Act }) {
  const prev = previewStrength(s)
  const xiIds = new Set(prev.xi.map((p) => p.id))
  const benchIds = new Set(prev.bench.map((p) => p.id))
  const hasGk = prev.xi.some((p) => p.pos === 'BR')
  const sorted = [...s.squad].sort((a, b) => {
    const rank = (p: Player) => (xiIds.has(p.id) ? 0 : benchIds.has(p.id) ? 1 : 2)
    return rank(a) - rank(b) || byPos(a, b)
  })
  return (
    <div>
      <div className="lineup-head">
        <h2>Skład na mecz</h2>
        <label className="small">
          <input
            type="checkbox"
            checked={s.lineup.auto}
            onChange={(e) => act((g) => setAutoLineup(g, e.target.checked))}
            style={{ width: 'auto', marginRight: 6 }}
          />
          Wybieraj automatycznie
        </label>
      </div>
      <div className="chips">
        <span className={`chip ${prev.xi.length === 11 ? 'good' : 'bad'}`}>Skład {prev.xi.length}/11</span>
        <span className="chip">Ławka {prev.bench.length}/7</span>
        <span className="chip">Ustawienie {formationOf(prev.xi)}</span>
        {!hasGk && <span className="chip bad">Brak bramkarza!</span>}
        <span className="chip">
          Atak {prev.att} · Obrona {prev.def}
        </span>
      </div>
      <p className="small muted">
        {s.lineup.auto
          ? 'Skład wybiera się sam pod ustawienie z zakładki Taktyka. Kliknij XI, Ł albo –, żeby przejść na ręczny wybór.'
          : 'Ręczny skład. Jeśli ktoś wypadnie przez kontuzję lub kartkę, jego miejsce zajmie zmiennik z ławki.'}
      </p>
      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Miejsce</th>
              <th>Poz.</th>
              <th className="left">Zawodnik</th>
              <th>Wiek</th>
              <th>Um.</th>
              <th>Pot.</th>
              <th>Forma</th>
              <th>Śr. ocen</th>
              <th>Morale</th>
              <th>G/A/M</th>
              <th>Pensja</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} className={xiIds.has(p.id) ? 'xi' : benchIds.has(p.id) ? 'bench' : ''}>
                <td>
                  <SlotPicker s={s} p={p} act={act} />
                </td>
                <td>
                  <span className={`pos pos-${p.pos}`}>{p.pos}</span>
                </td>
                <td className="left">
                  <div>
                    {playerName(p)} <Status p={p} />
                  </div>
                  <Traits p={p} />
                </td>
                <td>{p.age}</td>
                <td>
                  <b>{p.skill}</b>
                </td>
                <td className="muted">{p.potential > p.skill + 2 ? `↑${p.potential}` : '–'}</td>
                <td>
                  <Form v={p.form} />
                </td>
                <td>
                  <Rating r={avgRating(p)} />
                </td>
                <td>{p.morale}</td>
                <td>
                  {p.goals}/{p.assists}/{p.apps}
                </td>
                <td className="muted">{formatMoney(p.wage)}</td>
                <td>
                  <ConfirmButton
                    className="tiny ghost"
                    disabled={s.squad.length <= MIN_SQUAD}
                    label="Zwolnij"
                    confirmLabel={`Odprawa ${formatMoney(p.wage * 3)}?`}
                    onConfirm={() => act((g) => releasePlayer(g, p.id))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- taktyka ----------

export function TacticView({ s, act }: { s: GameState; act: Act }) {
  const prev = previewStrength(s)
  const bonus = teamBonus(s, prev.xi)
  const set = (patch: Partial<GameState['tactic']>) => act((g) => void Object.assign(g.tactic, patch))
  return (
    <div>
      <h2>Taktyka</h2>
      <h3>Ustawienie {s.lineup.auto ? '' : '(przy ręcznym składzie decyduje wybór zawodników)'}</h3>
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
      <p className="small muted">Atak: +3 do ataku, −3 do obrony. Obrona odwrotnie.</p>
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
          Atak <b>{prev.att}</b> · Obrona <b>{prev.def}</b> ({formationOf(prev.xi)})
        </div>
        <ul className="small">
          {bonus.parts.map((p) => (
            <li key={p.label}>
              {p.label}: {p.value > 0 ? '+' : ''}
              {p.value}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------- transfery ----------

export function TransferView({ s, act }: { s: GameState; act: Act }) {
  const bill = wageBill(s)
  return (
    <div>
      <div className="chips">
        <span className="chip">Budżet transferowy {formatMoney(s.budget)}</span>
        <span className={`chip ${bill > s.wageLimit ? 'bad' : ''}`}>
          Pensje {formatMoney(bill)} / limit {formatMoney(s.wageLimit)} miesięcznie
        </span>
        <span className="chip">
          Kadra {s.squad.length} (min. {MIN_SQUAD}, maks. {MAX_SQUAD})
        </span>
      </div>

      {s.bids.length > 0 && (
        <>
          <h2>Oferty za Twoich zawodników</h2>
          <div className="bids">
            {s.bids.map((b) => {
              const p = s.squad.find((x) => x.id === b.playerId)
              if (!p) return null
              return (
                <div key={b.playerId} className="bid">
                  <div>
                    <b>{teamName(s, b.teamId)}</b> chce kupić <b>{playerName(p)}</b> za <b>{formatMoney(b.fee)}</b>
                    <div className="small muted">
                      Wartość {formatMoney(p.value)} · średnia ocen {avgRating(p)?.toFixed(2) ?? '–'}
                      {s.teams[b.teamId].level > (club(s)?.level ?? 0) ? ' · zawodnik chciałby grać wyżej' : ''}
                    </div>
                  </div>
                  <div className="row">
                    <button className="tiny primary" onClick={() => act((g) => acceptBid(g, b.playerId))}>
                      Sprzedaj
                    </button>
                    <button className="tiny" disabled={b.countered} onClick={() => act((g) => counterBid(g, b.playerId))}>
                      Żądaj +40%
                    </button>
                    <button className="tiny ghost" onClick={() => act((g) => rejectBid(g, b.playerId))}>
                      Odrzuć
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <h2>Do kupienia</h2>
      <div className="scroll-x">
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
              <th>Pensja</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {s.transferList.map(({ player: p, fee, from }) => {
              const overWage = bill + p.wage > s.wageLimit
              return (
                <tr key={p.id}>
                  <td>
                    <span className={`pos pos-${p.pos}`}>{p.pos}</span>
                  </td>
                  <td className="left">
                    {playerName(p)}
                    <Traits p={p} />
                  </td>
                  <td>{p.age}</td>
                  <td>
                    <b>{p.skill}</b>
                  </td>
                  <td className="muted">{p.potential > p.skill + 2 ? `↑${p.potential}` : '–'}</td>
                  <td className="left small">{from}</td>
                  <td>{fee ? formatMoney(fee) : 'za darmo'}</td>
                  <td className={overWage ? 'warn-text' : ''}>{formatMoney(p.wage)}</td>
                  <td>
                    <button
                      className="tiny primary"
                      disabled={fee > s.budget || overWage || s.squad.length >= MAX_SQUAD}
                      title={overWage ? 'Przekroczysz limit pensji' : fee > s.budget ? 'Za mało pieniędzy' : ''}
                      onClick={() => act((g) => buyPlayer(g, p.id))}
                    >
                      Kup
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!s.transferList.length && <p className="muted">Rynek pusty. Wszyscy dobrzy poszli do rywala.</p>}

      <h2>Sprzedaż</h2>
      <p className="small muted">Szybka sprzedaż daje 70% wartości. Lepsze pieniądze dają oferty innych klubów.</p>
      <div className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Poz.</th>
              <th className="left">Zawodnik</th>
              <th>Wiek</th>
              <th>Um.</th>
              <th>Śr. ocen</th>
              <th>Wartość</th>
              <th>Pensja</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...s.squad].sort(byPos).map((p) => (
              <tr key={p.id}>
                <td>
                  <span className={`pos pos-${p.pos}`}>{p.pos}</span>
                </td>
                <td className="left">
                  {playerName(p)} <Status p={p} />
                  <Traits p={p} />
                </td>
                <td>{p.age}</td>
                <td>
                  <b>{p.skill}</b>
                </td>
                <td>
                  <Rating r={avgRating(p)} />
                </td>
                <td className="muted">{formatMoney(p.value)}</td>
                <td className="muted">{formatMoney(p.wage)}</td>
                <td>
                  <ConfirmButton
                    className="tiny"
                    disabled={s.squad.length <= MIN_SQUAD}
                    label="Sprzedaj"
                    confirmLabel={`Za ${formatMoney(Math.round((p.value * 0.7) / 100) * 100)}?`}
                    onConfirm={() => act((g) => sellPlayer(g, p.id))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
            {cupRoundName(i)} <span className="small muted">(tydzień {s.cup.schedule[i]})</span>
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
        {s.coach.courseLeft > 0 ? ' (na kursie)' : ''} · stres {s.coach.stress}/100
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
      <ConfirmButton
        className="ghost"
        label="Zakończ karierę"
        confirmLabel="Tak, kończę karierę"
        onConfirm={() =>
          act((g) => retire(g, team ? `Odszedłeś z ${team.name} w trakcie sezonu. Prezes do dziś nie wie dlaczego.` : 'Koniec.'))
        }
      />
    </div>
  )
}
