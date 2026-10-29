import { forwardRef } from 'react'
import { LEVELS } from '../game/data'
import type { careerCard } from '../game/engine'
import type { SeasonRecord } from '../game/types'
import { levelShort, lowestLevel } from '../game/world'
import { trophyLines } from '../game/endings'
import { ENDING_ICON, SHARE_SIZE, type ShareFormat } from './shareFormat'


/** prosta ścieżka przez ligi: bez podpowiedzi, czytelna i przy 1, i przy 40 sezonach */
function MiniPath({ history, region, w, h }: { history: SeasonRecord[]; region: string; w: number; h: number }) {
  if (!history.length)
    return (
      <div className="sc-empty" style={{ height: h }}>
        Kariera skończyła się przed pierwszym gwizdkiem.
      </div>
    )
  const left = 150
  const pad = 18
  const lo = Math.max(lowestLevel(region), Math.min(...history.map((x) => x.level)) - 1)
  const hi = Math.min(LEVELS.length - 1, Math.max(...history.map((x) => x.level)) + 1)
  const n = history.length
  const xOf = (i: number) => (n === 1 ? (left + w - pad) / 2 : left + (i * (w - left - pad)) / (n - 1))
  const yOf = (lv: number) => pad + ((hi - lv) * (h - 2 * pad)) / Math.max(1, hi - lo)
  const r = n > 30 ? 5 : n > 15 ? 7 : 9
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="sc-path">
      {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((lv) => (
        <g key={lv}>
          <line x1={left} x2={w - pad} y1={yOf(lv)} y2={yOf(lv)} className="sc-grid" />
          <text x={left - 12} y={yOf(lv) + 8} className="sc-axis" textAnchor="end">
            {levelShort(lv, region) ?? ''}
          </text>
        </g>
      ))}
      {history.slice(1).map((x, i) => (
        <line
          key={i}
          x1={xOf(i)}
          y1={yOf(history[i].level)}
          x2={xOf(i + 1)}
          y2={yOf(x.level)}
          className={x.clubName !== history[i].clubName ? 'sc-line jump' : 'sc-line'}
        />
      ))}
      {history.map((x, i) => {
        const cls = x.fired ? 'fired' : x.outcome.includes('mistrzostwo') ? 'title' : x.outcome.includes('awans') ? 'up' : x.outcome.includes('spadek') ? 'down' : 'none'
        return <circle key={i} cx={xOf(i)} cy={yOf(x.level)} r={cls === 'none' ? r * 0.6 : r} className={`sc-pt ${cls}`} />
      })}
    </svg>
  )
}

export interface ShareCardProps {
  card: ReturnType<typeof careerCard>
  history: SeasonRecord[]
  score: number
  mult: number
  startLicense?: string
  daily?: boolean
  seed: number
  version: string
  format: ShareFormat
}

/** karta do udostępnienia: stały rozmiar w pikselach, z niej powstaje PNG */
export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(function ShareCard(p, ref) {
  const { card, format } = p
  const { w, h } = SHARE_SIZE[format]
  const wide = format === 'poziom'
  const maxTrophies = wide ? 4 : 3
  // imię i nazwisko w dwóch linijkach; długie nazwisko dostaje mniejszą czcionkę zamiast wielokropka
  const longest = Math.max(card.firstName.length, card.lastName.length, 1)
  const nameSize = Math.max(36, Math.min(wide ? 64 : 80, Math.floor((wide ? 720 : 952) / (longest * 0.5))))
  const allLines = trophyLines(card.trophies)
  const trophies = allLines.slice(0, maxTrophies)
  const hidden = allLines.slice(maxTrophies).reduce((a, l) => a + l.count, 0)
  const ending = card.ending
  const multLabel = card.scenario
    ? `wyzwanie: ${card.scenario}`
    : p.mult !== 1
      ? `mnożnik ×${p.mult} za start (${p.startLicense})`
      : p.daily
        ? 'wyzwanie dnia'
        : 'zwykły start ×1'
  const badgeIcons = card.badges.slice(0, 6).map((b) => b.icon).join('') + (card.badges.length > 6 ? ` +${card.badges.length - 6}` : '')

  const header = (
    <div className="sc-head">
      <div className="sc-top">
        <span className="sc-badge">TRENER</span>
        {ending && (
          <span className={`sc-ending ${ending.kind}`}>
            {ENDING_ICON[ending.kind]} {ending.title}
          </span>
        )}
      </div>
      <div className="sc-name" style={{ fontSize: nameSize }}>
        <div>{card.firstName}</div>
        <div>{card.lastName}</div>
      </div>
      <div className="sc-sub">
        {card.age} lat · {card.region} · licencja {card.license}
        {badgeIcons && <span className="sc-badges"> · {badgeIcons}</span>}
      </div>
    </div>
  )
  const scoreBlock = (
    <div className="sc-score">
      <div className="sc-score-num">{p.score.toLocaleString('pl-PL')}</div>
      <div className="sc-score-lbl">punktów kariery · {multLabel}</div>
    </div>
  )
  const stats = (
    <div className="sc-stats">
      {[
        [card.seasons, 'sezonów'],
        [card.clubs.length, 'klubów'],
        [`${card.winPct}%`, 'wygranych'],
        [card.fired, 'zwolnień'],
      ].map(([v, l]) => (
        <div key={l as string}>
          <div className="sc-num">{v}</div>
          <div className="sc-lbl">{l}</div>
        </div>
      ))}
    </div>
  )
  const facts = (
    <div className="sc-facts">
      <div className="sc-fact">
        <div className="sc-lbl">Najwyższy szczebel</div>
        <div className="sc-val clamp-2">{card.peak}</div>
      </div>
      <div className="sc-fact">
        <div className="sc-lbl">Najlepszy podopieczny</div>
        <div className="sc-val">{card.bestPlayer ? `${card.bestPlayer.name} (${card.bestPlayer.skill})` : 'nikt się nie wybił'}</div>
      </div>
      <div className="sc-fact">
        <div className="sc-lbl">Trofea{card.trophies.length ? ` (${card.trophies.length})` : ''}</div>
        {trophies.length ? (
          <ul className="sc-trophies">
            {trophies.map((t) => (
              <li key={t.label} className="clamp-1">
                🏆 {t.label}
                {t.count > 1 && <b className="sc-count"> ×{t.count}</b>}
              </li>
            ))}
            {hidden > 0 && (
              <li className="sc-more">
                i jeszcze {hidden} {hidden === 1 ? 'trofeum' : hidden % 10 >= 2 && hidden % 10 <= 4 && (hidden % 100 < 12 || hidden % 100 > 14) ? 'trofea' : 'trofeów'}
              </li>
            )}
          </ul>
        ) : (
          <div className="sc-val">Gablota czeka. Kurz też.</div>
        )}
      </div>
      {card.scandal && (
        <div className="sc-fact sc-scandal">
          <div className="sc-lbl">Afera kariery</div>
          <div className="sc-val">{card.scandal}</div>
        </div>
      )}
    </div>
  )
  const quotes = (
    <div className="sc-quotes">
      <div className="sc-press">
        <span className="clamp-2">„{card.press.text}”</span>
        <span className="sc-src">{card.press.source}</span>
      </div>
      {card.lastWord && (
        <div className="sc-last">
          <span className="sc-lbl">Ostatnie słowo</span>
          <span className="clamp-2">„{card.lastWord}”</span>
        </div>
      )}
    </div>
  )
  const foot = (
    <div className="sc-foot">
      <span>Polski Trener Symulator</span>
      <span>
        v{p.version} · seed {p.seed}
      </span>
    </div>
  )

  return (
    <div ref={ref} className={`share-card ${format}`} style={{ width: w, height: h }}>
      {wide ? (
        <div className="sc-cols">
          <div className="sc-col">
            {header}
            {scoreBlock}
            {stats}
            <MiniPath history={p.history} region={p.card.region} w={720} h={200} />
          </div>
          <div className="sc-col">
            {facts}
            {quotes}
          </div>
        </div>
      ) : (
        <>
          {header}
          {scoreBlock}
          {stats}
          <MiniPath history={p.history} region={p.card.region} w={952} h={210} />
          {facts}
          {quotes}
        </>
      )}
      {foot}
    </div>
  )
})
