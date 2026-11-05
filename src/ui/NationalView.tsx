import { countryFlag } from '../game/europe'
import { eventShort, groupTable, nationalGoal, qualRule, REACHED_LABEL, SIDE_NAME, STAGE_LABEL } from '../game/national'
import type { GameState, NatGroup, NatKo } from '../game/types'

function TeamLabel({ s, id }: { s: GameState; id: number }) {
  const t = s.teams[id]
  if (!t) return <>?</>
  return (
    <>
      {t.country ? countryFlag(t.country) : ''} {t.name}
    </>
  )
}

function GroupTable({ s, g, promo, title }: { s: GameState; g: NatGroup; promo: number; title: string }) {
  const rows = groupTable(g)
  return (
    <div className="scroll-x">
      <h3>{title}</h3>
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
            <tr key={r.teamId} className={[r.teamId === s.clubId ? 'me' : '', i < promo ? 'promo' : ''].join(' ')}>
              <td>{i + 1}</td>
              <td className="left team-cell">
                <TeamLabel s={s} id={r.teamId} />
              </td>
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
    </div>
  )
}

/** mecze Polski w grupie: rozegrane z wynikiem, reszta z tygodniem; eliminacje z poprzedniego sezonu z dopiskiem */
function Fixtures({ s, g }: { s: GameState; g: NatGroup }) {
  const me = s.clubId
  const mine = g.rounds
    .map((r, i) => ({ f: r.find((x) => x.home === me || x.away === me), week: g.weeks[i], season: g.seasons?.[i] ?? s.season }))
    .filter((x) => x.f)
  return (
    <ul className="nat-fixtures small">
      {mine.map(({ f, week, season }, i) => (
        <li key={i} className={f!.hg === undefined ? 'muted' : ''}>
          <span className="nat-week">{season === s.season ? `tydz. ${week + 1}` : season < s.season ? `sezon ${season}` : `sezon ${season}, tydz. ${week + 1}`}</span> <TeamLabel s={s} id={f!.home} />{' '}
          {f!.hg !== undefined ? <b>{`${f!.hg}:${f!.ag}`}</b> : '–'} <TeamLabel s={s} id={f!.away} />
        </li>
      ))}
    </ul>
  )
}

function KoList({ s, list }: { s: GameState; list: NatKo[] }) {
  if (!list.length) return null
  return (
    <ul className="nat-fixtures small">
      {list.map((k) => (
        <li key={k.stage}>
          <span className="nat-week">{STAGE_LABEL[k.stage]}</span> <TeamLabel s={s} id={k.tie.home} />{' '}
          {k.tie.hg !== undefined ? <b>{`${k.tie.hg}:${k.tie.ag}${k.tie.pens ? ` (k. ${k.tie.pens})` : ''}`}</b> : '–'} <TeamLabel s={s} id={k.tie.away} />
        </li>
      ))}
    </ul>
  )
}

export function NationalTableView({ s }: { s: GameState }) {
  const job = s.national
  if (!job) return null
  const t = job.tourn
  const nl = job.nl
  const qualDone = job.qual.rounds.every((r) => r.every((f) => f.hg !== undefined))
  return (
    <div>
      <div className="table-head">
        <h2>
          🇵🇱 {SIDE_NAME[job.side]} · {nl ? nl.name : job.event}
        </h2>
      </div>
      <p className="small muted">
        {nationalGoal(job)}. Eliminacje trwają dwa sezony. {qualRule(job.side, job.event)}{' '}
        {job.side === 'A' ? 'Euro i mundial są co cztery lata, na zmianę, a w latach bez turnieju gra się Ligę Narodów.' : 'Euro U21 jest co dwa lata.'}
      </p>
      {t && (
        <>
          <GroupTable s={s} g={t.group} promo={2} title={t.group.name} />
          <Fixtures s={s} g={t.group} />
          <KoList s={s} list={t.ko} />
          <p className="small">
            Na razie: <b>{REACHED_LABEL[job.reached]}</b>
            {t.out ? ', koniec turnieju' : ''}.
          </p>
        </>
      )}
      {nl && (
        <>
          <GroupTable s={s} g={nl.group} promo={1} title={nl.group.name} />
          <p className="small muted">{nl.div === 'A' ? 'Zwycięzca grupy jedzie w czerwcu na Final Four, ostatni spada do dywizji B.' : 'Zwycięzca grupy awansuje do dywizji A.'}</p>
          <Fixtures s={s} g={nl.group} />
          {nl.finals.length > 0 && <h3>Final Four</h3>}
          <KoList s={s} list={nl.finals} />
          {nl.result && (
            <p className="small">
              Wynik: <b>{nl.result}</b>.
            </p>
          )}
        </>
      )}
      <GroupTable s={s} g={job.qual} promo={job.side === 'A' && job.event.startsWith('Mistrzostwa Świata') ? 1 : 2} title={job.qual.name} />
      <Fixtures s={s} g={job.qual} />
      {job.playoff && (
        <>
          <h3>Baraże o {eventShort(job.event)}</h3>
          <KoList s={s} list={job.playoff} />
        </>
      )}
      {!t && qualDone && !job.playoff?.some((k) => k.tie.winner === undefined) && <p className="small warn-text">Bez awansu na {eventShort(job.event)}.</p>}
    </div>
  )
}
