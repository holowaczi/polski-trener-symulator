import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { LEVELS } from '../game/data'
import { careerCard } from '../game/engine'
import type { GameState } from '../game/types'

function PathChart({ path }: { path: number[] }) {
  const w = 320
  const h = 120
  const pad = 14
  if (path.length === 0) return null
  // skala od najniższego poziomu w grze (klasa C) do Ekstraklasy
  const top = LEVELS.length - 1
  const pts = path.map((lv, i) => {
    const x = path.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (path.length - 1)
    const y = h - pad - (lv * (h - pad * 2)) / top
    return [x, y] as const
  })
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="path-chart" role="img" aria-label="Ścieżka kariery według poziomu ligi">
      {[0, top].map((lv) => {
        const y = h - pad - (lv * (h - pad * 2)) / top
        return (
          <g key={lv}>
            <line x1={pad} x2={w - pad} y1={y} y2={y} className="grid" />
            <text x={pad} y={y - 3} className="axis">
              {lv === top ? LEVELS[lv].name : 'Najniższa klasa'}
            </text>
          </g>
        )
      })}
      <polyline points={pts.map((p) => p.join(',')).join(' ')} className="path-line" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} className="path-dot" />
      ))}
    </svg>
  )
}

export function CareerCard({ s, onNew }: { s: GameState; onNew: () => void }) {
  const card = careerCard(s)
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

  const shareText = `${card.name}: ${card.seasons} sezonów, ${card.clubs.length} klubów, szczyt: ${card.peak}. Trofea: ${card.trophies.length}. Zwolnienia: ${card.fired}. #PolskiTrenerSymulator`

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

        <PathChart path={card.path} />

        <dl className="cc-facts">
          <dt>Bilans</dt>
          <dd>{card.record}</dd>
          <dt>Szczyt kariery</dt>
          <dd>{card.peak}</dd>
          <dt>Kluby</dt>
          <dd>{card.clubs.join(' → ') || 'brak'}</dd>
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
