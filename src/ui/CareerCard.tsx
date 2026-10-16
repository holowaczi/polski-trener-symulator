import { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { LEVELS } from '../game/data'
import { careerCard } from '../game/engine'
import { careerScore, multiplierOf, scoreBreakdown } from '../game/score'
import { saveRecord } from './save'
import type { GameState, SeasonRecord } from '../game/types'

/** krótkie nazwy poziomów na oś wykresu */
const SHORT = ['C', 'B', 'B', 'A', 'Okręg.', 'IV', 'III', 'II', 'I', 'Ekstra']

type Mark = 'up' | 'down' | 'title' | 'fired' | 'none'

function markOf(h: SeasonRecord): Mark {
  if (h.fired) return 'fired'
  if (h.outcome.includes('mistrzostwo')) return 'title'
  if (h.outcome.includes('awans')) return 'up'
  if (h.outcome.includes('spadek')) return 'down'
  return 'none'
}

const MARK_LABEL: Record<Mark, string> = { up: '▲ awans', down: '▼ spadek', title: '🏆 mistrzostwo', fired: '✕ zwolnienie', none: '' }

/** okresy w jednym klubie */
function stintsOf(history: SeasonRecord[]) {
  const out: { club: string; from: number; to: number; seasons: SeasonRecord[] }[] = []
  history.forEach((h, i) => {
    const last = out[out.length - 1]
    if (last && last.club === h.clubName && last.to === i - 1) {
      last.to = i
      last.seasons.push(h)
    } else out.push({ club: h.clubName, from: i, to: i, seasons: [h] })
  })
  return out
}

function PathChart({ history }: { history: SeasonRecord[] }) {
  const [active, setActive] = useState<number | null>(null)
  if (history.length === 0) return null
  const w = 400
  const h = 210
  const left = 44
  const right = 12
  const topPad = 22
  const bottom = 22
  const lo = Math.max(0, Math.min(...history.map((x) => x.level)) - 1)
  const hi = LEVELS.length - 1
  const n = history.length
  const xOf = (i: number) => (n === 1 ? (left + w - right) / 2 : left + (i * (w - left - right)) / (n - 1))
  const yOf = (lv: number) => topPad + ((hi - lv) * (h - topPad - bottom)) / Math.max(1, hi - lo)
  const half = n === 1 ? (w - left - right) / 2 : (w - left - right) / (n - 1) / 2
  const stints = stintsOf(history)
  const cur = active !== null ? history[active] : undefined
  const prev = active !== null && active > 0 ? history[active - 1] : undefined
  return (
    <div className="path-wrap" onMouseLeave={() => setActive(null)}>
      <div className="path-title">Droga przez ligi</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="path-chart" role="img" aria-label="Ścieżka kariery według poziomu ligi">
        {/* tło: każdy klub ma swój pas */}
        {stints.map((st, k) => {
          const x1 = Math.max(left - 4, xOf(st.from) - half)
          const x2 = Math.min(w - right + 4, xOf(st.to) + half)
          return (
            <g key={k}>
              <rect x={x1} y={topPad - 14} width={x2 - x1} height={h - topPad - bottom + 18} className={k % 2 ? 'band alt' : 'band'} />
              {k > 0 && <line x1={x1} x2={x1} y1={topPad - 14} y2={h - bottom + 4} className="club-change" />}
              {x2 - x1 > 44 && (
                <text x={(x1 + x2) / 2} y={topPad - 4} className="band-label" textAnchor="middle">
                  {st.club.length > 16 ? `${st.club.slice(0, 15)}…` : st.club}
                </text>
              )}
            </g>
          )
        })}
        {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((lv) => (
          <g key={lv}>
            <line x1={left} x2={w - right} y1={yOf(lv)} y2={yOf(lv)} className="grid" />
            <text x={left - 6} y={yOf(lv) + 3} className="axis" textAnchor="end">
              {SHORT[lv]}
            </text>
          </g>
        ))}
        {history.slice(1).map((x, i) => {
          const a = history[i]
          const cls = x.level > a.level ? 'seg up' : x.level < a.level ? 'seg down' : 'seg'
          return <line key={i} x1={xOf(i)} y1={yOf(a.level)} x2={xOf(i + 1)} y2={yOf(x.level)} className={cls} />
        })}
        {history.map((x, i) => {
          const m = markOf(x)
          const cx = xOf(i)
          const cy = yOf(x.level)
          const on = active === i
          return (
            <g key={i} className={`pt ${m}${on ? ' on' : ''}`}>
              {m === 'up' && <polygon points={`${cx},${cy - 6} ${cx - 5},${cy + 3} ${cx + 5},${cy + 3}`} />}
              {m === 'down' && <polygon points={`${cx},${cy + 6} ${cx - 5},${cy - 3} ${cx + 5},${cy - 3}`} />}
              {m === 'title' && <circle cx={cx} cy={cy} r={5.5} />}
              {m === 'fired' && <path d={`M${cx - 4} ${cy - 4} L${cx + 4} ${cy + 4} M${cx + 4} ${cy - 4} L${cx - 4} ${cy + 4}`} />}
              {m === 'none' && <circle cx={cx} cy={cy} r={3.5} />}
              {on && <circle cx={cx} cy={cy} r={9} className="halo" />}
              <rect
                x={cx - half}
                y={topPad - 14}
                width={half * 2}
                height={h - topPad - bottom + 18}
                className="hit"
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(active === i ? null : i)}
              />
            </g>
          )
        })}
        <text x={left} y={h - 6} className="axis">
          sezon {history[0].season}
        </text>
        <text x={w - right} y={h - 6} className="axis" textAnchor="end">
          sezon {history[n - 1].season}
        </text>
      </svg>
      {cur ? (
        <div className="path-tip">
          <div className="tip-head">
            Sezon {cur.season} · <b>{cur.clubName}</b>
          </div>
          <div>{cur.leagueName}</div>
          <div>
            {cur.position ? `${cur.position}. miejsce` : ''}
            {markOf(cur) !== 'none' && <span className={`tip-mark ${markOf(cur)}`}> {MARK_LABEL[markOf(cur)]}</span>}
          </div>
          {cur.outcome.includes('baraże') && <div className="muted">{cur.outcome.includes('wygrane') ? 'Baraże wygrane' : 'Baraże przegrane'}</div>}
          <div className="muted">Puchar: {cur.cup}</div>
          {prev && prev.clubName !== cur.clubName && <div className="muted">Nowy klub, wcześniej {prev.clubName}</div>}
        </div>
      ) : (
        <div className="path-tip hint small muted">Najedź albo stuknij w sezon, żeby zobaczyć szczegóły.</div>
      )}
      <div className="path-legend small">
        <span className="pt up">▲ awans</span>
        <span className="pt down">▼ spadek</span>
        <span className="pt title">● mistrzostwo</span>
        <span className="pt fired">✕ zwolnienie</span>
        <span className="muted">pasy: kolejne kluby</span>
      </div>
    </div>
  )
}

/** przebieg kariery klub po klubie */
function Stints({ history }: { history: SeasonRecord[] }) {
  const stints = stintsOf(history)
  if (!stints.length) return null
  return (
    <ol className="stints">
      {stints.map((st, k) => {
        const first = st.seasons[0]
        const last = st.seasons[st.seasons.length - 1]
        const ups = st.seasons.filter((x) => x.outcome.includes('awans')).length
        const downs = st.seasons.filter((x) => x.outcome.includes('spadek')).length
        const titles = st.seasons.filter((x) => x.outcome.includes('mistrzostwo')).length
        const shortLeague = (x: SeasonRecord) => x.leagueName.split(' · ')[0].replace(/ \(.*\)$/, '')
        return (
          <li key={k}>
            <div className="stint-head">
              <b>{st.club}</b>
              <span className="muted small">
                {first.season === last.season ? `sezon ${first.season}` : `sezony ${first.season}–${last.season}`}
              </span>
            </div>
            <div className="small">
              {shortLeague(first)}
              {shortLeague(last) !== shortLeague(first) ? ` → ${shortLeague(last)}` : ''}
              {ups > 0 && <span className="stint-chip up">▲ {ups > 1 ? `${ups}× ` : ''}awans</span>}
              {downs > 0 && <span className="stint-chip down">▼ {downs > 1 ? `${downs}× ` : ''}spadek</span>}
              {titles > 0 && <span className="stint-chip title">🏆 {titles > 1 ? `${titles}× ` : ''}mistrzostwo</span>}
              {last.fired && <span className="stint-chip fired">✕ zwolniony</span>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function CareerCard({ s, onNew }: { s: GameState; onNew: () => void }) {
  const card = careerCard(s)
  const score = careerScore(s)
  const mult = multiplierOf(s)
  const lines = scoreBreakdown(s)

  useEffect(() => {
    if (!s.history.length) return
    saveRecord({
      id: `${s.seed}-${card.name}-${s.season}`,
      name: card.name,
      score,
      multiplier: mult,
      peak: card.peak,
      daily: s.start?.daily,
      date: new Date().toISOString().slice(0, 10),
    })
  }, [s, card.name, card.peak, score, mult])
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const download = async () => {
    if (!ref.current) return
    setBusy(true)
    try {
      const bg = getComputedStyle(document.body).backgroundColor
      const url = await toPng(ref.current, { pixelRatio: 2, backgroundColor: bg })
      // obrazek pokazujemy też na stronie, bo nie każda przeglądarka pozwala pobrać plik
      setImage(url)
      const a = document.createElement('a')
      a.href = url
      a.download = `kariera-${card.name.replace(/\s+/g, '-').toLowerCase()}.png`
      a.click()
    } finally {
      setBusy(false)
    }
  }

  const shareText = `${card.name}: ${score} pkt kariery, ${card.seasons} sezonów, ${card.clubs.length} klubów, szczyt: ${card.peak}. Trofea: ${card.trophies.length}. Zwolnienia: ${card.fired}. #PolskiTrenerSymulator`

  return (
    <main className="retired">
      <div ref={ref} className="career-card">
        <div className="cc-head">
          <div className="cc-badge">TRENER</div>
          <h1>{card.name}</h1>
          <div className="muted">
            {card.age} lat · {card.region} · licencja {card.license}
          </div>
        </div>

        <div className="cc-grid">
          <div>
            <div className="cc-num">{card.seasons}</div>
            <div className="cc-lbl">sezonów</div>
          </div>
          <div>
            <div className="cc-num">{card.clubs.length}</div>
            <div className="cc-lbl">klubów</div>
          </div>
          <div>
            <div className="cc-num">{card.winPct}%</div>
            <div className="cc-lbl">wygranych</div>
          </div>
          <div>
            <div className="cc-num">{card.fired}</div>
            <div className="cc-lbl">zwolnień</div>
          </div>
        </div>

        <div className="cc-score">
          <div className="cc-score-num">{score.toLocaleString('pl-PL')}</div>
          <div className="cc-lbl">
            punktów kariery{mult !== 1 ? ` · mnożnik ×${mult} za start (${s.start?.license})` : s.start?.daily ? ' · wyzwanie dnia' : ''}
          </div>
          <ul className="cc-score-lines">
            {lines.map((l) => (
              <li key={l.label}>
                <span>{l.label}</span>
                <b>{l.points > 0 ? '+' : ''}{l.points}</b>
              </li>
            ))}
          </ul>
        </div>

        <PathChart history={s.history} />
        <Stints history={s.history} />

        <dl className="cc-facts">
          <dt>Bilans</dt>
          <dd>{card.record}</dd>
          <dt>Szczyt kariery</dt>
          <dd>{card.peak}</dd>
          {card.bestPlayer && (
            <>
              <dt>Najlepszy podopieczny</dt>
              <dd>
                {card.bestPlayer.name} ({card.bestPlayer.skill})
              </dd>
            </>
          )}
          {card.scandal && (
            <>
              <dt>Afera kariery</dt>
              <dd>{card.scandal}</dd>
            </>
          )}
        </dl>

        {card.trophies.length > 0 && (
          <ul className="cc-trophies">
            {card.trophies.map((t, i) => (
              <li key={i}>🏆 {t}</li>
            ))}
          </ul>
        )}

        <blockquote>„{card.quote}”</blockquote>
        <p className="small muted">{card.reason}</p>
        <div className="cc-foot">Polski Trener Symulator</div>
      </div>

      <div className="row center">
        <button className="primary" onClick={download} disabled={busy}>
          {busy ? 'Generuję…' : 'Pobierz kartę (PNG)'}
        </button>
        <button
          onClick={() => {
            navigator.clipboard
              ?.writeText(shareText)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? 'Skopiowano' : 'Kopiuj tekst na X'}
        </button>
        <button className="ghost" onClick={onNew}>
          Nowa kariera
        </button>
      </div>
      <p className="share-text small muted">{shareText}</p>
      {image && (
        <figure className="card-image">
          <img src={image} alt={`Karta trenera ${card.name}`} />
          <figcaption className="small muted">Jeśli plik się nie pobrał, przytrzymaj obrazek albo kliknij go prawym przyciskiem i zapisz.</figcaption>
        </figure>
      )}
    </main>
  )
}
