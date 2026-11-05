import { countryFlag } from '../game/europe'
import { eventShort, groupTable, KO_WEEKS, REACHED_LABEL, SIDE_NAME, STAGE_LABEL } from '../game/national'
import type { GameState, NatGroup } from '../game/types'

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

/** mecze Polski w grupie: rozegrane z wynikiem, reszta z tygodniem */
function Fixtures({ s, g }: { s: GameState; g: NatGroup }) {
  const me = s.clubId
  const mine = g.rounds
    .map((r, i) => ({ f: r.find((x) => x.home === me || x.away === me), week: g.weeks[i] }))
    .filter((x) => x.f)
  return (
    <ul className="nat-fixtures small">
      {mine.map(({ f, week }, i) => (
        <li key={i} className={f!.hg === undefined ? 'muted' : ''}>
          <span className="nat-week">tydz. {week + 1}</span> <TeamLabel s={s} id={f!.home} /> {f!.hg !== undefined ? <b>{`${f!.hg}:${f!.ag}`}</b> : '–'} <TeamLabel s={s} id={f!.away} />
        </li>
      ))}
    </ul>
  )
}

export function NationalTableView({ s }: { s: GameState }) {
  const job = s.national
  if (!job) return null
  const t = job.tourn
  return (
    <div>
      <div className="table-head">
        <h2>
          🇵🇱 {SIDE_NAME[job.side]} · {job.event}
        </h2>
      </div>
      <p className="small muted">
        Eliminacje grane są w przerwach na kadrę: dwie najlepsze drużyny z grupy jadą latem na turniej. Na turnieju z grupy wychodzą dwie drużyny, dalej ćwierćfinał (tydzień {KO_WEEKS.QF + 1}),
        półfinał i finał.
      </p>
      {t && (
        <>
          <GroupTable s={s} g={t.group} promo={2} title={t.group.name} />
          <Fixtures s={s} g={t.group} />
          {t.ko.length > 0 && (
            <ul className="nat-fixtures small">
              {t.ko.map((k) => (
                <li key={k.stage}>
                  <span className="nat-week">{STAGE_LABEL[k.stage]}</span> <TeamLabel s={s} id={k.tie.home} />{' '}
                  {k.tie.hg !== undefined ? <b>{`${k.tie.hg}:${k.tie.ag}${k.tie.pens ? ` (k. ${k.tie.pens})` : ''}`}</b> : '–'} <TeamLabel s={s} id={k.tie.away} />
                </li>
              ))}
            </ul>
          )}
          <p className="small">
            Na razie: <b>{REACHED_LABEL[job.reached]}</b>
            {t.out ? ', koniec turnieju' : ''}.
          </p>
        </>
      )}
      <GroupTable s={s} g={job.qual} promo={2} title={job.qual.name} />
      <Fixtures s={s} g={job.qual} />
      {!t && job.qual.rounds.every((r) => r.every((f) => f.hg !== undefined)) && <p className="small warn-text">Bez awansu na {eventShort(job.event)}.</p>}
    </div>
  )
}
