import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { LEVELS } from '../game/data'
import { careerCard } from '../game/engine'
import { careerScore, multiplierOf, scoreBreakdown } from '../game/score'
import { saveRecord } from './save'
import { levelShort, lowestLevel } from '../game/world'
import type { GameState, SeasonRecord } from '../game/types'
import { ShareCard } from './ShareCard'
import { ENDING_ICON, SHARE_SIZE, type ShareFormat } from './shareFormat'

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

function PathChart({ history, region }: { history: SeasonRecord[]; region: string }) {
  const [active, setActive] = useState<number | null>(null)
  if (history.length === 0) return null
  const w = 400
  const h = 210
  const left = 62
  const right = 12
  const topPad = 22
  const bottom = 22
  const lo = Math.max(lowestLevel(region), Math.min(...history.map((x) => x.level)) - 1)
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
              {levelShort(lv, region) ?? ''}
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

/** podgląd karty do udostępnienia: zmniejszony do szerokości ekranu */
function useFitScale(width: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / width))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return { ref, scale }
}

type ShareNav = Navigator & { canShare?: (d: ShareData) => boolean }

export function CareerCard({ s, onNew }: { s: GameState; onNew: () => void }) {
  const card = careerCard(s)
  const score = careerScore(s)
  const mult = multiplierOf(s)
  const lines = scoreBreakdown(s)
  const version = __APP_VERSION__.replace('-alpha', ' alfa')

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

  const [format, setFormat] = useState<ShareFormat>('pion')
  const size = SHARE_SIZE[format]
  const { ref: fitRef, scale } = useFitScale(size.w)
  const shareRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const fileName = `kariera-${card.name.replace(/\s+/g, '-').toLowerCase()}-${format}.png`

  const render = useCallback(async () => {
    if (!shareRef.current) return null
    const url = await toPng(shareRef.current, { width: size.w, height: size.h, pixelRatio: 1, cacheBust: true })
    const blob = await (await fetch(url)).blob()
    return { url, file: new File([blob], fileName, { type: 'image/png' }) }
  }, [size.w, size.h, fileName])

  // obrazek przygotowujemy zawczasu: telefon pozwala udostępnić tylko zaraz po stuknięciu
  useEffect(() => {
    let live = true
    setFile(null)
    const t = setTimeout(() => {
      render()
        .then((r) => {
          if (live && r) {
            setFile(r.file)
            setImage(r.url)
          }
        })
        .catch(() => undefined)
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [render])

  const shareText = `${card.name}: ${score.toLocaleString('pl-PL')} pkt kariery, ${card.seasons} ${card.seasons === 1 ? 'sezon' : 'sezonów'}, szczyt: ${card.peak}. Trofea: ${card.trophies.length}. Zwolnienia: ${card.fired}.${card.ending ? ` Koniec: ${card.ending.title.toLowerCase()}.` : ''} #PolskiTrenerSymulator`

  const download = (url: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setNote('Karta pobrana. Jeśli plik się nie pobrał, przytrzymaj obrazek poniżej albo kliknij go prawym przyciskiem i zapisz.')
  }

  const getReady = async () => {
    if (file && image) return { url: image, file }
    setBusy(true)
    try {
      const r = await render()
      if (r) {
        setFile(r.file)
        setImage(r.url)
      }
      return r
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    const nav = navigator as ShareNav
    const r = await getReady()
    if (!r) return
    if (nav.share && nav.canShare?.({ files: [r.file] })) {
      try {
        await nav.share({ files: [r.file], text: shareText, title: `Karta trenera ${card.name}` })
        setNote(null)
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
      }
    }
    download(r.url)
  }

  return (
    <main className="retired">
      <div className="career-card">
        <div className="cc-head">
          <div className="cc-badge">TRENER</div>
          <h1>{card.name}</h1>
          <div className="muted">
            {card.age} lat · {card.region} · licencja {card.license}
          </div>
        </div>

        {card.ending && (
          <div className={`cc-ending ${card.ending.kind}`}>
            <div className="cc-ending-title">
              {ENDING_ICON[card.ending.kind]} {card.ending.title}
            </div>
            {card.ending.headline && <div className="cc-headline">{card.ending.headline}</div>}
            <p>{card.ending.text}</p>
          </div>
        )}

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

        <PathChart history={s.history} region={s.coach.region} />
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

        <blockquote>
          „{card.press.text}”<cite>{card.press.source}</cite>
        </blockquote>
        {card.lastWord && (
          <p className="cc-last">
            <span className="muted small">Ostatnie słowo: </span>„{card.lastWord}”
          </p>
        )}
        <div className="cc-foot">
          Polski Trener Symulator · v{version} · seed {s.seed}
        </div>
      </div>

      <section className="share-panel">
        <h2>Pokaż znajomym</h2>
        <div className="segmented" role="group" aria-label="Format obrazka">
          <button className={format === 'pion' ? 'active' : ''} aria-pressed={format === 'pion'} onClick={() => setFormat('pion')}>
            Pion · Instagram
          </button>
          <button className={format === 'poziom' ? 'active' : ''} aria-pressed={format === 'poziom'} onClick={() => setFormat('poziom')}>
            Poziom · X
          </button>
        </div>
        <div className="share-preview" ref={fitRef}>
          <div style={{ width: size.w * scale, height: size.h * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: size.w }}>
              <ShareCard
                ref={shareRef}
                card={card}
                history={s.history}
                score={score}
                mult={mult}
                startLicense={s.start?.license}
                daily={s.start?.daily}
                seed={s.seed}
                version={version}
                format={format}
              />
            </div>
          </div>
        </div>
        <div className="row center">
          <button className="primary" onClick={share} disabled={busy}>
            {busy ? 'Przygotowuję…' : '📤 Udostępnij'}
          </button>
          <button onClick={() => getReady().then((r) => r && download(r.url))} disabled={busy}>
            Pobierz PNG
          </button>
          <button
            onClick={() => {
              navigator.clipboard
                ?.writeText(shareText)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }}
          >
            {copied ? 'Skopiowano' : 'Kopiuj tekst'}
          </button>
        </div>
        {note && <p className="small muted center-text">{note}</p>}
        <p className="share-text small muted">{shareText}</p>
        {note && image && (
          <figure className="card-image">
            <img src={image} alt={`Karta trenera ${card.name}`} />
          </figure>
        )}
      </section>

      <div className="row center">
        <button className="ghost" onClick={onNew}>
          Nowa kariera
        </button>
      </div>
    </main>
  )
}
