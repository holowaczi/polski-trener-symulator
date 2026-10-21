import { useEffect, useState } from 'react'
import type { Act } from '../App'
import { FORMATIONS, LEVELS, STYLE_INFO, TRAITS } from '../game/data'
import { club, clubLeague, computeTable, cupsOf, directPromotion, formatMoney, hasPlayoffs, relegationSlots, retire, setAutoLineup, setPlayerSlot, type SlotState } from '../game/engine'
import { acceptBid, buyPlayer, counterBid, MAX_SQUAD, MIN_SQUAD, rejectBid, releasePlayer, roleIfSigned, ROLE_LABEL, sellPlayer, signingLimit, squadRoles, type SquadRole } from '../game/market'
import { formationOf, previewStrength, teamBonus } from '../game/match'
import type { Cup, CupTie, EuroLeague, EuroRun, EuroTie, Formation, GameState, MatchReport, Mentality, Player, PlayerRating, Style } from '../game/types'
import { avgRating, wageBill, withRng } from '../game/util'
import { acceptDemand, canNegotiate, haggle, letGo, wageDemand, wantedYears } from '../game/contracts'
import { isPolish, nationInfo, nationOf, playerName } from '../game/world'
import { cupLabel, roundName } from '../game/cup'
import { callUp, reserveTeamName, sendDown } from '../game/reserves'
import { COMP_GEN, COMP_ICON, COMP_NAME, countryFlag, euroResult, euroTable, STAGE_NAME } from '../game/europe'

/** dwuetapowe potwierdzenie w samym przycisku, bez okienek przeglądarki */
export function ConfirmButton(props: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  className?: string
  disabled?: boolean
  title?: string
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
      title={props.title}
      onClick={() => (armed ? props.onConfirm() : setArmed(true))}
    >
      {armed ? props.confirmLabel : props.label}
    </button>
  )
}

/** kto wygrał karne, z zapisu „gospodarze:goście” */
function pensWinner(pens: string): 'home' | 'away' {
  const [a, b] = pens.split(':').map(Number)
  return a > b ? 'home' : 'away'
}

function teamName(s: GameState, id: number) {
  return s.teams[id]?.name ?? '?'
}

function Form({ v }: { v: number }) {
  const arrows = ['⇊', '↓', '↘', '→', '↗', '↑', '⇈']
  const tone = v > 0 ? 'good' : v < 0 ? 'bad' : ''
  return (
    <span className={`form-arrow ${tone}`} title={`Forma ${v > 0 ? '+' : ''}${v}`}>
      {arrows[v + 3]}
    </span>
  )
}

export function Rating({ r }: { r?: number }) {
  if (r === undefined) return <span className="muted">–</span>
  const tone = r >= 7.5 ? 'r-hi' : r < 5.5 ? 'r-lo' : 'r-mid'
  return <span className={`rating ${tone}`}>{r.toFixed(1)}</span>
}

/** czerwony krzyżyk zamiast emoji przy kontuzjach */
function withInjuryCross(text: string) {
  const parts = text.split('✚')
  if (parts.length === 1) return text
  return parts.map((t, i) => (
    <span key={i}>
      {i > 0 && <span className="injury-cross">✚</span>}
      {t}
    </span>
  ))
}

function Status({ p }: { p: Player }) {
  const chips = []
  if (p.injuredFor > 0)
    chips.push(
      <span key="i" className="chip bad" title={`kontuzja: nie zagra w ${p.injuredFor} m.`}>
        <span className="injury-cross">✚</span> {p.injuredFor} m.
      </span>,
    )
  if (p.suspendedFor > 0)
    chips.push(
      <span key="s" className="chip bad" title={`zawieszony: pauzuje ${p.suspendedFor} m.`}>
        ⛔ pauza {p.suspendedFor} m.
      </span>,
    )
  else if (p.yellows > 0)
    chips.push(
      <span key="y" className={`chip ${p.yellows >= 3 ? 'bad' : ''}`} title="żółte kartki (4 = pauza)">
        🟨 {p.yellows}/4
      </span>,
    )
  return chips.length ? <>{chips}</> : null
}

/** flaga przy zagranicznym zawodniku; Polacy jej nie potrzebują */
function Flag({ p }: { p: Player }) {
  if (isPolish(p)) return null
  const n = nationInfo(nationOf(p))
  return (
    <span className="flag" title={n.country} aria-label={n.country}>
      {n.flag}
    </span>
  )
}

/** gdzie zawodnik ląduje w hierarchii: pierwsza jedenastka, ławka albo rezerwy */
function RoleTag({ role, note }: { role: SquadRole; note?: string }) {
  const title =
    role === 'xi' ? 'Przy obecnym ustawieniu grałby od pierwszej minuty' : role === 'bench' ? 'Siedziałby na ławce rezerwowych' : 'Poza kadrą meczową: trybuny albo mecze rezerw'
  return (
    <span className={`role-tag role-${role}`} title={title}>
      {ROLE_LABEL[role]}
      {note && <span className="role-note"> {note}</span>}
    </span>
  )
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

/** skala ocen jak w gazecie: od czerwieni przez szarość do zieleni */
function ratingTone(r: number): string {
  if (r >= 8) return 'rt-5'
  if (r >= 7) return 'rt-4'
  if (r >= 6) return 'rt-3'
  if (r >= 5) return 'rt-2'
  return 'rt-1'
}

function RatingRow({ x, best }: { x: PlayerRating; best: boolean }) {
  const icons: string[] = []
  for (let i = 0; i < (x.goals ?? 0); i++) icons.push('⚽')
  for (let i = 0; i < (x.assists ?? 0); i++) icons.push('🅰️')
  if (x.red) icons.push('🟥')
  else if (x.yellow) icons.push('🟨')
  return (
    <li className={`rt-row ${best ? 'rt-best' : ''}`}>
      <span className={`pos pos-${x.pos}`}>{x.pos}</span>
      <span className="rt-name">
        {x.name}
        {best && <span className="rt-star" title="Zawodnik meczu"> ★</span>}
        {icons.length > 0 && <span className="rt-icons"> {icons.join('')}</span>}
        {x.injured && <span className="injury-cross" title="kontuzja"> ✚</span>}
      </span>
      <span className="rt-min">{x.minutes !== undefined ? `${x.minutes}'` : ''}</span>
      <span className={`rt-badge ${ratingTone(x.rating)}`}>{x.rating.toFixed(1)}</span>
    </li>
  )
}

function RatingsTable({ ratings }: { ratings: PlayerRating[] }) {
  if (!ratings.length) return null
  const best = Math.max(...ratings.map((x) => x.rating))
  const bestId = ratings.find((x) => x.rating === best)?.id
  const starters = ratings.filter((x) => !x.sub)
  const subs = ratings.filter((x) => x.sub)
  const avg = ratings.reduce((a, x) => a + x.rating, 0) / ratings.length
  return (
    <section className="rt" aria-label="Oceny zawodników">
      <div className="rt-head">
        <h4>Oceny</h4>
        <span className="small muted">średnia drużyny {avg.toFixed(1)}</span>
      </div>
      <ul className="rt-list">
        {starters.map((x) => (
          <RatingRow key={x.id} x={x} best={x.id === bestId} />
        ))}
      </ul>
      {subs.length > 0 && (
        <>
          <div className="rt-sub-label small muted">Z ławki</div>
          <ul className="rt-list">
            {subs.map((x) => (
              <RatingRow key={x.id} x={x} best={x.id === bestId} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

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
      {reports.map((r, i) => (
        <ReportCard key={i} s={s} r={r} latest={i === 0} />
      ))}
    </div>
  )
}

/** raport z jednego meczu: na liście meczów i w okienku „Ostatni mecz” */
export function ReportCard({ s, r, latest }: { s: GameState; r: MatchReport; latest?: boolean }) {
  const me = r.me ?? s.clubId
  const mine = r.home === me ? r.hg - r.ag : r.ag - r.hg
  const tone = mine > 0 ? 'win' : mine < 0 ? 'loss' : 'draw'
  // kolor rozgrywek: liga, Puchar Polski, baraże, Liga Mistrzów, Liga Europy, Liga Konferencji
  const compClass = r.playoff ? 'comp-po' : r.euro ? `comp-${r.comp ?? 'LKE'}` : r.cup ? 'comp-pp' : 'comp-liga'
  return (
    <article className={`report ${tone} ${latest ? 'latest' : ''} ${compClass}`}>
      <div className="report-head">
        <div className="report-top">
          {r.playoff ? (
            <span className="comp-tag">⚔️ {r.cupName ?? 'Baraże'}</span>
          ) : r.euro ? (
            <span className="comp-tag">{r.comp ? COMP_ICON[r.comp] : '🌍'} {r.cupName ?? 'Europa'}</span>
          ) : r.cup ? (
            <span className="comp-tag">🏆 {r.cupName ?? 'Puchar Polski'}</span>
          ) : (
            <span className="comp-tag">Liga · kolejka {r.round + 1}</span>
          )}
          <span className="result-badge">{mine > 0 ? 'Wygrana' : mine < 0 ? 'Porażka' : r.pens ? `Remis · karne ${(pensWinner(r.pens) === 'home') === (r.home === me) ? 'wygrane' : 'przegrane'}` : 'Remis'}</span>
        </div>
        <div className="score">
          <span className={r.pens && pensWinner(r.pens) === 'home' ? 'pens-win' : ''}>{teamName(s, r.home)}</span>
          <b>
            {r.hg}:{r.ag}
          </b>
          <span className={r.pens && pensWinner(r.pens) === 'away' ? 'pens-win' : ''}>{teamName(s, r.away)}</span>
        </div>
        {r.agg && <div className="pens-line">{r.agg}</div>}
        {r.pens && (
          <div className="pens-line">
            Rzuty karne <b>{r.pens}</b> · {pensWinner(r.pens) === 'home' ? teamName(s, r.home) : teamName(s, r.away)}{' '}
            {r.trophy ? `zdobywa ${r.trophy}` : !r.playoff ? 'awansuje dalej' : r.cupName?.includes('półfinał') ? 'gra w finale baraży' : 'wygrywa baraż'}
          </div>
        )}
        {r.trophy && !r.pens && (
          <div className="pens-line">
            🏆 {teamName(s, r.hg > r.ag ? r.home : r.away)} zdobywa {r.trophy}
          </div>
        )}
      </div>
      {latest && (
        <>
          <div className="small muted">
            Siła: atak {r.myStrength.att}, obrona {r.myStrength.def} · rywal {r.oppStrength}
          </div>
          <ul className="match-events">
            {r.events.map((e, j) => (
              <li key={j}>{withInjuryCross(e)}</li>
            ))}
          </ul>
          {r.lines.length > 0 && <ul className="lines">
            {r.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>}
          <RatingsTable ratings={r.ratings} />
        </>
      )}
    </article>
  )
}

// ---------- tabela ----------

/** nazwa poziomu w województwie gracza, np. „Klasa A”, bo ta sama głębokość nazywa się różnie w różnych regionach */
function levelLabel(s: GameState, level: number): string {
  const lg = s.leagues.find((l) => l.level === level)
  if (!lg) return LEVELS[level].name
  if (level === 6) return 'III liga'
  return lg.group ? lg.name.split(' · ')[0] : lg.name.replace(/ \(.*\)$/, '')
}

function groupsNote(n: number): string {
  if (n < 2) return ''
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
  return ` Na tym poziomie ${few ? 'grają' : 'gra'} ${n} ${few ? 'grupy' : 'grup'}.`
}

export function TableView({ s }: { s: GameState }) {
  const mine = clubLeague(s)
  const [pick, setPick] = useState<number | null>(null)
  const lg = s.leagues[pick ?? (mine ? s.leagues.indexOf(mine) : 0)]
  if (!lg) return null
  const rows = computeTable(lg)
  const size = rows.length
  const up = directPromotion(s, lg.level)
  const po = hasPlayoffs(s, lg.level) ? 4 : 0
  const down = relegationSlots(s, lg)
  const playoff = (s.playoffs?.length ? s.playoffs : s.lastPlayoffs)?.find((x) => x.level === lg.level)
  const levels = [...new Set(s.leagues.map((l) => l.level))].sort((a, b) => b - a)
  return (
    <div className="scroll-x">
      <div className="table-head">
        <h2>{lg.name}</h2>
        <select
          aria-label="Pokaż tabelę"
          value={s.leagues.indexOf(lg)}
          onChange={(e) => setPick(Number(e.target.value))}
        >
          {levels.map((lv) => (
            <optgroup key={lv} label={levelLabel(s, lv)}>
              {s.leagues.map((l, i) =>
                l.level === lv ? (
                  <option key={i} value={i}>
                    {l === mine ? '★ ' : ''}
                    {l.level === 6 && l.group ? `grupa ${l.group}` : l.level === 5 && l.region ? l.region : (l.group ?? l.name)}
                  </option>
                ) : null,
              )}
            </optgroup>
          ))}
        </select>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th className="left">Drużyna</th>
            <th>M</th>
            <th className="hide-sm">Z</th>
            <th className="hide-sm">R</th>
            <th className="hide-sm">P</th>
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
                i < up ? 'promo' : i < up + po ? 'playoff-row' : '',
                i >= size - down ? 'releg' : '',
              ].join(' ')}
            >
              <td>{i + 1}</td>
              <td className="left team-cell">{teamName(s, r.teamId)}</td>
              <td>{r.p}</td>
              <td className="hide-sm">{r.w}</td>
              <td className="hide-sm">{r.d}</td>
              <td className="hide-sm">{r.l}</td>
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
      <p className="small muted">
        Zielone: awans{up === 1 && !po ? ' (tylko mistrz grupy)' : ''}.{po ? ` Fioletowe: baraże o ${LEVELS[lg.level + 1].name} (miejsca ${up + 1}–${up + po}).` : ''} Czerwone: spadek
        {down ? ` (${down})` : ''}.{groupsNote(s.leagues.filter((l) => l.level === lg.level).length)}
      </p>
      {playoff && (
        <div className="cup-stage">
          <h3>
            ⚔️ {playoff.title}
            {playoff === s.lastPlayoffs?.find((x) => x.level === lg.level) && !s.playoffs?.length ? ' (poprzedni sezon)' : ''}
          </h3>
          {playoff.rounds.map((ties, i) => (
            <div key={i}>
              <h4>{playoff.names![i]}</h4>
              <ul className="cup-list">
                {ties.map((t, j) => (
                  <CupTieRow key={j} s={s} t={t} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
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
  const resName = reserveTeamName(s)
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
        <span className="chip" title="Zawodnicy, których może powołać selekcjoner reprezentacji Polski">
          🇵🇱 Polaków {s.squad.filter(isPolish).length}/{s.squad.length}
        </span>
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
        <table className="table stack">
          <thead>
            <tr>
              <th>Miejsce</th>
              <th>Poz.</th>
              <th className="left">Zawodnik</th>
              <th>Wiek</th>
              <th>Um.</th>
              <th>Pot.</th>
              <th title="Sezony do końca umowy">Umowa</th>
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
                <td className="cell-slot">
                  <SlotPicker s={s} p={p} act={act} />
                </td>
                <td className="cell-pos">
                  <span className={`pos pos-${p.pos}`}>{p.pos}</span>
                </td>
                <td className="left cell-name">
                  <div>
                    {playerName(p)} <Flag p={p} /> <Status p={p} />
                  </div>
                  <Traits p={p} />
                </td>
                <td data-label="Wiek">{p.age}</td>
                <td data-label="Um.">
                  <b>{p.skill}</b>
                </td>
                <td className="muted hide-sm" data-label="Pot.">{p.potential > p.skill + 2 ? `↑${p.potential}` : '–'}</td>
                <td data-label="Umowa">
                  <Contract p={p} />
                </td>
                <td data-label="Forma">
                  <Form v={p.form} />
                </td>
                <td data-label="Śr.">
                  <Rating r={avgRating(p)} />
                </td>
                <td className="hide-sm" data-label="Morale">{p.morale}</td>
                <td className="hide-sm" data-label="G/A/M">
                  {p.goals}/{p.assists}/{p.apps}
                </td>
                <td className="muted hide-sm" data-label="Pensja">{formatMoney(p.wage)}</td>
                <td className="cell-action">
                  {resName && (
                    <button className="tiny ghost" disabled={s.squad.length <= MIN_SQUAD} title={`Wyślij do ${resName}`} onClick={() => act((g) => sendDown(g, p.id))}>
                      ⬇ Rezerwy
                    </button>
                  )}
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
      {resName && <ReserveList s={s} act={act} name={resName} />}
    </div>
  )
}

function ReserveList({ s, act, name }: { s: GameState; act: Act; name: string }) {
  const list = [...(s.reserveSquad ?? [])].sort((a, b) => Number(!!b.sentDown) - Number(!!a.sentDown) || b.skill - a.skill)
  const full = s.squad.length >= MAX_SQUAD
  return (
    <div className="reserves">
      <h2>Rezerwy: {name}</h2>
      <p className="small muted">
        Młodzi zesłani do rezerw grają co tydzień i po sezonie wracają lepsi. Starsi biorą to do siebie. Zesłani wracają sami po sezonie, ale możesz ich powołać wcześniej.
      </p>
      {list.length === 0 ? (
        <p className="small muted">W rezerwach pusto. Nawet kierownik drużyny poszedł do domu.</p>
      ) : (
        <div className="scroll-x">
          <table className="table stack">
            <thead>
              <tr>
                <th>Poz.</th>
                <th className="left">Zawodnik</th>
                <th>Wiek</th>
                <th>Um.</th>
                <th>Pot.</th>
                <th>Pensja</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="cell-pos">
                    <span className={`pos pos-${p.pos}`}>{p.pos}</span>
                  </td>
                  <td className="left cell-name">
                    <div>
                      {playerName(p)} {p.sentDown && <span className="chip tiny-chip">zesłany</span>}
                    </div>
                    <Traits p={p} />
                  </td>
                  <td data-label="Wiek">{p.age}</td>
                  <td data-label="Um.">
                    <b>{p.skill}</b>
                  </td>
                  <td className="muted" data-label="Pot.">{p.potential > p.skill + 2 ? `↑${p.potential}` : '–'}</td>
                  <td className="muted" data-label="Pensja">{p.sentDown ? formatMoney(p.wage) : `${formatMoney(p.wage)} po powołaniu`}</td>
                  <td className="cell-action">
                    <button className="tiny" disabled={full} onClick={() => act((g) => callUp(g, p.id))}>
                      ⬆ Powołaj
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

function Contract({ p }: { p: Player }) {
  const c = p.contract ?? 1
  if (c <= 0) return <span className="warn-text">wygasa</span>
  return <span className={c === 1 ? 'warn-text' : 'muted'}>{c} sez.</span>
}

/** rozmowy o nowych umowach: wygasające i w ostatnim roku */
function ContractTalks({ s, act }: { s: GameState; act: Act }) {
  const fresh = s.squad.filter((p) => p.newSigning && (p.contract ?? 1) <= 1)
  const talks = s.squad.filter((p) => (p.contract ?? 1) <= 1 && !p.newSigning).sort((a, b) => (a.contract ?? 1) - (b.contract ?? 1) || b.skill - a.skill)
  if (!talks.length && !fresh.length) return null
  const bill = wageBill(s)
  const open = talks.filter((p) => !p.talksOver)
  const extra = open.reduce((a, p) => a + (p.haggled ?? wageDemand(s, p)) - p.wage, 0)
  return (
    <>
      <div className="section-head">
        <h2>Umowy do przedłużenia</h2>
        {open.length > 1 && (
          <ConfirmButton
            className="tiny"
            label={`Podpisz wszystkich (+${formatMoney(extra)}/mies.)`}
            confirmLabel="Na pewno? Bez targowania"
            onConfirm={() =>
              act((g) => {
                let n = 0
                for (const p of [...g.squad].sort((a, b) => b.skill - a.skill))
                  if (canNegotiate(p) && acceptDemand(g, p.id).includes('podpisuje')) n++
                return n ? `Podpisano ${n} ${n === 1 ? 'umowę' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'umowy' : 'umów'}. Księgowa łapie się za głowę.` : 'Nikogo nie da się podpisać w limicie pensji.'
              })
            }
          />
        )}
      </div>
      <p className="small muted">
        <span className="warn-text">Wygasa</span>: odejdzie za darmo po zamknięciu okna. <span className="warn-text">1 sez.</span>: można przedłużyć już teraz.
        Targowanie zbija pensję o 15%, ale drugie podejście kończy rozmowy.
      </p>
      {fresh.length > 0 && (
        <p className="small muted">
          Nowi zawodnicy z umową na sezon ({fresh.map((p) => playerName(p)).join(', ')}): dopiero co podpisali, o przedłużeniu porozmawiacie najwcześniej w kolejnym oknie.
        </p>
      )}
      <div className="bids">
        {talks.map((p) => {
          const demand = p.haggled ?? wageDemand(s, p)
          const years = wantedYears(p)
          const over = bill - p.wage + demand > s.wageLimit
          return (
            <div key={p.id} className="bid">
              <div>
                <div className="bid-title">
                  <span className={`pos pos-${p.pos}`}>{p.pos}</span> <b>{playerName(p)}</b> <Contract p={p} />
                </div>
                <div className="small">
                  {formatMoney(p.wage)} → <b>{formatMoney(demand)}</b>/mies. na {years} {years === 1 ? 'sezon' : 'sezony'}
                </div>
                <div className="small muted">
                  {p.age} l. · um. {p.skill} · śr. ocen {avgRating(p)?.toFixed(2) ?? '–'} · morale {p.morale}
                  {p.talksOver ? ' · zerwał rozmowy' : p.haggled ? ' · nie zejdzie niżej' : ''}
                  {over ? ' · przekroczy limit pensji' : ''}
                </div>
              </div>
              <div className="row">
                <button className="tiny primary" disabled={p.talksOver || over} onClick={() => act((g) => acceptDemand(g, p.id))}>
                  Podpisz
                </button>
                <button className="tiny" disabled={p.talksOver} onClick={() => act((g) => withRng(g, (rng) => haggle(rng, g, p.id)))}>
                  Targuj się
                </button>
                <ConfirmButton className="tiny ghost" label="Pożegnaj" confirmLabel="Na pewno?" disabled={s.squad.length <= MIN_SQUAD} onConfirm={() => act((g) => letGo(g, p.id))} />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

type TransferSection = 'umowy' | 'oferty' | 'kupno' | 'sprzedaz'

export function TransferView({ s, act }: { s: GameState; act: Act }) {
  const bill = wageBill(s)
  const talks = s.squad.filter((p) => (p.contract ?? 1) <= 1).length
  const sections: { id: TransferSection; label: string; count?: number }[] = [
    ...(talks ? [{ id: 'umowy' as const, label: 'Umowy', count: talks }] : []),
    ...(s.bids.length ? [{ id: 'oferty' as const, label: 'Oferty', count: s.bids.length }] : []),
    { id: 'kupno', label: 'Kupno', count: s.transferList.length },
    { id: 'sprzedaz', label: 'Sprzedaż' },
  ]
  const [want, setSec] = useState<TransferSection | null>(null)
  const full = (s.signings ?? 0) >= signingLimit(s)
  const roles = squadRoles(s)
  const sec = sections.some((x) => x.id === want) ? want! : sections[0].id
  return (
    <div>
      <div className="chips">
        <span className="chip">💰 {formatMoney(s.budget)}</span>
        <span className={`chip ${bill > s.wageLimit ? 'bad' : ''}`} title="Pensje zawodników miesięcznie / limit">
          Pensje {formatMoney(bill)} / {formatMoney(s.wageLimit)}
        </span>
        <span className="chip" title={`Minimum ${MIN_SQUAD}, maksimum ${MAX_SQUAD}`}>
          Kadra {s.squad.length}/{MAX_SQUAD}
        </span>
      </div>

      <div className="segmented" role="tablist" aria-label="Okno transferowe">
        {sections.map((x) => (
          <button key={x.id} role="tab" aria-selected={sec === x.id} className={sec === x.id ? 'active' : ''} onClick={() => setSec(x.id)}>
            {x.label}
            {x.count ? <span className="count">{x.count}</span> : null}
          </button>
        ))}
      </div>

      {sec === 'umowy' && <ContractTalks s={s} act={act} />}

      {sec === 'oferty' && (
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
                      {ROLE_LABEL[roles.get(p.id) ?? 'out']} · wartość {formatMoney(p.value)} · średnia ocen {avgRating(p)?.toFixed(2) ?? '–'}
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

      {sec === 'kupno' && (
        <>
      <div className="section-head">
        <h2>Do kupienia</h2>
        <span className={`chip ${full ? 'bad' : ''}`} title="Zarząd pozwala na kilku nowych w jednym oknie">
          Nowi w tym oknie: {s.signings ?? 0}/{signingLimit(s)}
        </span>
      </div>
      <p className="small muted">
        „W składzie” podpowiada, gdzie trafiłby zawodnik przy obecnym ustawieniu z zakładki Taktyka: do pierwszej jedenastki (i kogo by z niej wypchnął), na ławkę czy do
        rezerw. Kontuzje i kartki pomijamy, bo kiedyś się kończą.
      </p>
      <div className="scroll-x">
        <table className="table stack">
          <thead>
            <tr>
              <th>Poz.</th>
              <th className="left">Zawodnik</th>
              <th className="left" title="Gdzie trafiłby przy obecnym ustawieniu i składzie">W składzie</th>
              <th>Wiek</th>
              <th>Um.</th>
              <th>Pot.</th>
              <th title="Długość umowy, którą podpisze">Umowa</th>
              <th className="left">Skąd</th>
              <th>Cena</th>
              <th>Pensja</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {s.transferList.map(({ player: p, fee, from }) => {
              const overWage = bill + p.wage > s.wageLimit
              const fit = roleIfSigned(s, p)
              return (
                <tr key={p.id}>
                  <td className="cell-pos">
                    <span className={`pos pos-${p.pos}`}>{p.pos}</span>
                  </td>
                  <td className="left cell-name">
                    {playerName(p)} <Flag p={p} />
                    <Traits p={p} />
                  </td>
                  <td className="left" data-label="W składzie">
                    <RoleTag role={fit.role} note={fit.replaces ? `za ${fit.replaces.firstName[0]}. ${fit.replaces.lastName}` : undefined} />
                  </td>
                  <td data-label="Wiek">{p.age}</td>
                  <td data-label="Um.">
                    <b>{p.skill}</b>
                  </td>
                  <td className="muted " data-label="Pot.">{p.potential > p.skill + 2 ? `↑${p.potential}` : '–'}</td>
                  <td data-label="Umowa">
                    <Contract p={p} />
                  </td>
                  <td className="left small" data-label="Skąd">{from}</td>
                  <td data-label="Cena">
                    <b>{fee ? formatMoney(fee) : 'za darmo'}</b>
                  </td>
                  <td className={overWage ? 'warn-text' : ''} data-label="Pensja">{formatMoney(p.wage)}</td>
                  <td className="cell-action">
                    <button
                      className="tiny primary"
                      disabled={fee > s.budget || overWage || s.squad.length >= MAX_SQUAD || full}
                      title={full ? 'Limit nowych zawodników w tym oknie' : overWage ? 'Przekroczysz limit pensji' : fee > s.budget ? 'Za mało pieniędzy' : ''}
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
        </>
      )}

      {sec === 'sprzedaz' && (
        <>
      <h2>Sprzedaż</h2>
      <p className="small muted">
        Szybka sprzedaż daje 70% wartości, a zawodnik w ostatnim roku umowy tylko 45%. Lepsze pieniądze dają oferty innych klubów.
      </p>
      <div className="scroll-x">
        <table className="table stack">
          <thead>
            <tr>
              <th>Poz.</th>
              <th className="left">Zawodnik</th>
              <th className="left" title="Miejsce w składzie przy obecnym ustawieniu">W składzie</th>
              <th>Wiek</th>
              <th>Um.</th>
              <th>Umowa</th>
              <th>Śr. ocen</th>
              <th>Wartość</th>
              <th>Pensja</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {[...s.squad].sort(byPos).map((p) => (
              <tr key={p.id}>
                <td className="cell-pos">
                  <span className={`pos pos-${p.pos}`}>{p.pos}</span>
                </td>
                <td className="left cell-name">
                  {playerName(p)} <Flag p={p} /> <Status p={p} />
                  <Traits p={p} />
                </td>
                <td className="left" data-label="W składzie">
                  <RoleTag role={roles.get(p.id) ?? 'out'} />
                </td>
                <td data-label="Wiek">{p.age}</td>
                <td data-label="Um.">
                  <b>{p.skill}</b>
                </td>
                <td data-label="Umowa">
                  <Contract p={p} />
                </td>
                <td data-label="Śr.">
                  <Rating r={avgRating(p)} />
                </td>
                <td className="muted" data-label="Wartość">{formatMoney(p.value)}</td>
                <td className="muted" data-label="Pensja">{formatMoney(p.wage)}</td>
                <td className="cell-action">
                  <ConfirmButton
                    className="tiny"
                    disabled={s.squad.length <= MIN_SQUAD}
                    label="Sprzedaj"
                    confirmLabel={`Za ${formatMoney(Math.round((p.value * ((p.contract ?? 1) <= 1 ? 0.45 : 0.7)) / 100) * 100)}?`}
                    onConfirm={() => act((g) => sellPlayer(g, p.id))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </>
      )}
    </div>
  )
}

// ---------- puchar ----------

function CupTieRow({ s, t }: { s: GameState; t: CupTie }) {
  const mine = t.home === s.clubId || t.away === s.clubId
  return (
    <li className={mine ? 'me' : ''}>
      <span className={t.winner === t.home ? 'win-name' : ''}>{teamName(s, t.home)}</span>{' '}
      <span className="muted small">({cupLabel(s, t.home)})</span> <b>{t.hg !== undefined ? `${t.hg}:${t.ag}` : 'vs'}</b>
      {t.pens && <span className="pens-chip">k. {t.pens}</span>}{' '}
      <span className={t.winner === t.away ? 'win-name' : ''}>{teamName(s, t.away)}</span>{' '}
      <span className="muted small">({cupLabel(s, t.away)})</span>
    </li>
  )
}

function CupBracket({ s, cup }: { s: GameState; cup: Cup }) {
  const isMine = (t: CupTie) => t.home === s.clubId || t.away === s.clubId
  const waiting = cup.byes?.includes(s.clubId ?? -1)
  return (
    <section className="cup-stage">
      <h3>{cup.title ?? 'Puchar Polski'}</h3>
      {waiting && <p className="small">Macie wolny los w pierwszej rundzie, wchodzicie do gry w następnej.</p>}
      {cup.winner !== undefined && (
        <p>
          🏆 Zwycięzca: <b>{teamName(s, cup.winner)}</b>
        </p>
      )}
      {cup.rounds.map((round, i) => {
        const mine = round.filter(isMine)
        const rest = round.filter((t) => !isMine(t))
        return (
          <div key={i} className="cup-round">
            <h4>
              {roundName(cup, i)} <span className="small muted">(tydzień {cup.schedule[i]})</span>
            </h4>
            {round.length <= 8 ? (
              <ul className="cup-list">
                {round.map((t, j) => (
                  <CupTieRow key={j} s={s} t={t} />
                ))}
              </ul>
            ) : (
              <>
                {mine.length > 0 && (
                  <ul className="cup-list">
                    {mine.map((t, j) => (
                      <CupTieRow key={j} s={s} t={t} />
                    ))}
                  </ul>
                )}
                <details>
                  <summary className="small">Pozostałe mecze ({rest.length})</summary>
                  <ul className="cup-list">
                    {rest.map((t, j) => (
                      <CupTieRow key={j} s={s} t={t} />
                    ))}
                  </ul>
                </details>
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}

function EuroTieRow({ s, run, t }: { s: GameState; run: EuroRun; t: EuroTie }) {
  const opp = s.teams[t.opp]
  const me = run.teamId
  return (
    <li>
      <div>
        <b>{STAGE_NAME[t.stage]}</b>
        {t.comp !== run.comp || run.ties.some((x) => x.comp !== t.comp) ? <span className="muted small"> · {COMP_NAME[t.comp]}</span> : null}
        {': '}
        {opp ? (
          <>
            {countryFlag(opp.country ?? '')} {opp.name} <span className="muted small">({opp.country}, siła {opp.strength})</span>
          </>
        ) : (
          'rywal'
        )}
      </div>
      <div className="small">
        {t.legs.map((l, i) => {
          const where = t.legs.length === 1 ? 'finał' : l.home === me ? 'u siebie' : 'wyjazd'
          const score = l.hg === undefined ? `tydzień ${t.weeks[i]}` : l.home === me ? `${l.hg}:${l.ag}` : `${l.ag}:${l.hg}`
          return (
            <span key={i}>
              {i > 0 && ' · '}
              {where} <b>{score}</b>
            </span>
          )
        })}
        {t.pens && <span className="pens-chip">k. {t.pens}</span>}
        {t.won !== undefined && <span className={t.won ? 'win' : 'loss'}> · {t.won ? (t.stage === 'F' ? 'zwycięstwo!' : 'awans') : 'odpadnięcie'}</span>}
      </div>
    </li>
  )
}

/** faza ligowa: nasze kolejki i tabela 36 drużyn */
function EuroLeagueView({ s, run, lp }: { s: GameState; run: EuroRun; lp: EuroLeague }) {
  const me = run.teamId
  const table = euroTable(lp)
  const myRow = table.find((r) => r.teamId === me)
  const pos = table.findIndex((r) => r.teamId === me) + 1
  const played = myRow?.p ?? 0
  return (
    <>
      <b>Faza ligowa {COMP_GEN[lp.comp]}</b>
      <div className="small">
        {played ? (
          <>
            {lp.rank !== undefined ? 'Na koniec' : `Po ${played} z ${lp.weeks.length} kolejek`}: <b>{pos}. miejsce</b>, {myRow!.pts} pkt, bilans {myRow!.w}-{myRow!.d}-{myRow!.l}, bramki{' '}
            {myRow!.gf}:{myRow!.ga}
            {lp.rank !== undefined && (
              <span className={lp.rank <= 24 ? 'win' : 'loss'}>
                {' '}
                · {lp.rank <= 8 ? 'prosto do 1/8 finału' : lp.rank <= 24 ? 'baraże o 1/8 finału' : 'odpadnięcie'}
              </span>
            )}
          </>
        ) : (
          <>Miejsca 1–8 dają 1/8 finału, 9–24 baraże, reszta odpada.</>
        )}
      </div>
      <ol className="euro-fixtures small">
        {lp.rounds.map((round, i) => {
          const f = round.find((x) => x.home === me || x.away === me)!
          const home = f.home === me
          const opp = s.teams[home ? f.away : f.home]
          const res = f.hg === undefined ? undefined : home ? f.hg - f.ag! : f.ag! - f.hg
          return (
            <li key={i}>
              <span className="muted">{i + 1}. kol. (tydz. {lp.weeks[i]})</span> {home ? 'u siebie' : 'wyjazd'}: {opp ? `${countryFlag(opp.country ?? '')} ${opp.name}` : '?'}{' '}
              {f.hg !== undefined && (
                <b className={res! > 0 ? 'win' : res! < 0 ? 'loss' : 'draw'}>{home ? `${f.hg}:${f.ag}` : `${f.ag}:${f.hg}`}</b>
              )}
            </li>
          )
        })}
      </ol>
      <details open={played > 0}>
        <summary className="small">Tabela fazy ligowej</summary>
        <div className="scroll-x">
          <table className="table euro-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="left">Drużyna</th>
                <th>M</th>
                <th>Bramki</th>
                <th>Pkt</th>
              </tr>
            </thead>
            <tbody>
              {table.map((r, i) => {
                const t = s.teams[r.teamId]
                const zone = i < 8 ? 'zone-top' : i < 24 ? 'zone-mid' : 'zone-out'
                return (
                  <tr key={r.teamId} className={`${zone} ${r.teamId === me ? 'me' : ''}`}>
                    <td>{i + 1}</td>
                    <td className="left">
                      {t?.country ? countryFlag(t.country) : '🇵🇱'} {t?.name ?? '?'}
                    </td>
                    <td>{r.p}</td>
                    <td>
                      {r.gf}:{r.ga}
                    </td>
                    <td>
                      <b>{r.pts}</b>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">Zielony pasek: 1/8 finału. Żółty: baraże. Każda drużyna gra z różnymi rywalami, więc tabela jest jedna dla wszystkich.</p>
      </details>
    </>
  )
}

function EuroSection({ s }: { s: GameState }) {
  const run = s.euro && s.euro.teamId === s.clubId && s.euro.season === s.season ? s.euro : undefined
  const spots = s.euroSpots ?? []
  if (!run)
    return (
      <section className="euro-stage">
        <h3>🌍 Europejskie puchary</h3>
        <p className="small muted">
          Mistrz Polski gra w eliminacjach Ligi Mistrzów, zdobywca Pucharu Polski w Lidze Europy, a 2. i 3. drużyna Ekstraklasy w Lidze Konferencji. Kto odpadnie z
          eliminacji Ligi Mistrzów albo Ligi Europy, gra dalej w słabszych rozgrywkach.
        </p>
        {spots.length > 0 && (
          <p className="small">
            Polskę reprezentują: {spots.map((x) => `${s.teams[x.teamId]?.name ?? '?'} (${COMP_NAME[x.comp]})`).join(', ')}.
          </p>
        )}
      </section>
    )
  const qual = run.ties.filter((t) => ['Q2', 'Q3', 'PO'].includes(t.stage))
  const ko = run.ties.filter((t) => !qual.includes(t))
  const lp = run.league
  return (
    <section className={`euro-stage comp-${run.comp}`}>
      <h3>
        🌍 {COMP_ICON[run.comp]} {COMP_NAME[run.comp]}
      </h3>
      {run.done && <p>{run.champion ? <b>🏆 Puchar jest nasz!</b> : <>Koniec przygody · {euroResult(run)}</>}</p>}
      <ul className="euro-ties">
        {qual.map((t, i) => (
          <EuroTieRow key={`q${i}`} s={s} run={run} t={t} />
        ))}
        {lp && (
          <li>
            <EuroLeagueView s={s} run={run} lp={lp} />
          </li>
        )}
        {ko.map((t, i) => (
          <EuroTieRow key={`k${i}`} s={s} run={run} t={t} />
        ))}
      </ul>
      <p className="small muted">Eliminacje i faza pucharowa to dwumecze. Przy remisie w dwumeczu są od razu karne. Faza ligowa to osobne mecze z różnymi rywalami (w Lidze Konferencji sześć, w pozostałych osiem). Finał to jeden mecz.</p>
    </section>
  )
}

export function CupView({ s }: { s: GameState }) {
  const cups = cupsOf(s)
  const playing = (cup: Cup) =>
    cup.byes?.includes(s.clubId ?? -1) || cup.rounds.some((r) => r.some((t) => t.home === s.clubId || t.away === s.clubId))
  const inAny = cups.some(playing)
  // najpierw etap, w którym gra klub gracza
  const ordered = [...cups].sort((a, b) => Number(playing(b)) - Number(playing(a)))
  const inEurope = s.euro?.teamId === s.clubId && s.euro?.season === s.season
  return (
    <div>
      {inEurope && <EuroSection s={s} />}
      <h2>Puchar Polski</h2>
      <p className="small muted">
        Niższe ligi zaczynają od etapu wojewódzkiego, który trwa cały sezon. Jego zwycięzca gra w następnym sezonie w etapie centralnym: II liga i część III ligi
        zaczynają od rundy wstępnej, a Ekstraklasa, I liga i zdobywcy pucharów wojewódzkich od 1/32 finału. Gospodarzem jest drużyna z niższej ligi.
      </p>
      {!inAny && <p className="muted">W tym sezonie nie gracie w pucharze. Okręgowy związek zgubił zgłoszenie.</p>}
      {ordered.map((cup, i) => (
        <CupBracket key={i} s={s} cup={cup} />
      ))}
      {!inEurope && <EuroSection s={s} />}
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
