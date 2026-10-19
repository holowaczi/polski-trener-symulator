import type { Act } from '../App'
import { askBoard, askOutlook } from '../game/board'
import { LICENSE_COURSES, LICENSES } from '../game/data'
import { club, clubLeague, clubPosition, formatMoney, goalLabel, licenseStatus } from '../game/engine'
import { careerScore, multiplierOf } from '../game/score'
import { BURNOUT_END, DIRT_END } from '../game/endings'
import type { GameState } from '../game/types'
import { wageBill, withRng } from '../game/util'
import { parentTeam, reserveTeamName } from '../game/reserves'

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** pasek 0–100 z kolorem: zielony dobrze, czerwony źle */
export function Bar({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const v = invert ? 100 - value : value
  const tone = v < 25 ? 'bad' : v < 50 ? 'warn' : 'good'
  return (
    <div className="bar" title={`${label}: ${value}/100`}>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className={`bar-fill ${tone}`} style={{ width: `${value}%` }} />
      </span>
      <span className="bar-val">{value}</span>
    </div>
  )
}

// ---------- klub ----------

export function ClubView({ s, act }: { s: GameState; act: Act }) {
  const t = club(s)
  const lg = clubLeague(s)
  if (!t || !lg) return null
  const pos = s.round > 0 ? clubPosition(s) : undefined
  const bill = wageBill(s)
  const expiring = s.squad.filter((p) => (p.contract ?? 1) <= 1).length
  const o = askOutlook(s, pos)
  return (
    <div className="profile">
      <h2>{t.name}</h2>
      <p className="muted">
        {t.town} · {lg.name}
        {pos ? ` · ${pos}. miejsce` : ''} · cel: {goalLabel(s.goal, t.level).toLowerCase()}
      </p>

      <h3>Relacje</h3>
      <div className="bars">
        <Bar label="Zarząd" value={s.trust.board} />
        <Bar label="Szatnia" value={s.trust.squad} />
        <Bar label="Kibice" value={s.trust.fans} />
      </div>

      <h3>Finanse i kadra</h3>
      <dl className="facts">
        <dt>Budżet transferowy</dt>
        <dd>{formatMoney(s.budget)}</dd>
        <dt>Pensje zawodników</dt>
        <dd className={bill > s.wageLimit ? 'warn-text' : ''}>
          {formatMoney(bill)} / limit {formatMoney(s.wageLimit)} miesięcznie
        </dd>
        <dt>Kadra</dt>
        <dd>
          {s.squad.length} zawodników, średnia wieku {avg(s.squad.map((p) => p.age)).toFixed(1)}
        </dd>
        <dt>Kończące się umowy</dt>
        <dd>{expiring ? `${expiring} (ostatni rok albo wygasłe)` : 'brak'}</dd>
        {reserveTeamName(s) && (
          <>
            <dt>Rezerwy</dt>
            <dd>
              {reserveTeamName(s)} · {s.reserveSquad?.length ?? 0} zawodników ({s.reserveSquad?.filter((p) => p.sentDown).length ?? 0} zesłanych)
            </dd>
          </>
        )}
        {parentTeam(s, t.id) && (
          <>
            <dt>Pierwsza drużyna</dt>
            <dd>{parentTeam(s, t.id)!.name}. Może zabrać ci najlepszego młodego, ale jak tam zwolnią trenera, możesz dostać szansę.</dd>
          </>
        )}
        {s.interim && (
          <>
            <dt>Zastępstwo</dt>
            <dd className="warn-text">Prowadzisz pierwszą drużynę na zastępstwo. Utrzymaj ją, a zostaniesz na stałe. Jak nie, wracasz do rezerw.</dd>
          </>
        )}
      </dl>

      <h3>Gabinet prezesa</h3>
      <p>
        <b>{o.label}</b> <span className="muted small">(nastrój {o.mood}/100)</span>
      </p>
      <ul className="small muted reasons">
        {o.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {o.waitWeeks > 0 && (
        <p className="small warn-text">
          Ostatnio prosiłeś niedawno. Kolejna rozmowa za {o.waitWeeks} {o.waitWeeks === 1 ? 'tydzień' : 'tygodnie'}, wcześniej tylko zdenerwujesz prezesa.
        </p>
      )}
      <div className="row">
        <button onClick={() => act((g) => withRng(g, (rng) => askBoard(rng, g, 'transfery', s.round > 0 ? clubPosition(g) : undefined)))}>
          Poproś o pieniądze na transfery
        </button>
        <button onClick={() => act((g) => withRng(g, (rng) => askBoard(rng, g, 'pensje', s.round > 0 ? clubPosition(g) : undefined)))}>
          Poproś o wyższy limit pensji
        </button>
      </div>
      <p className="small muted">
        Prezes patrzy na relacje z zarządem, ostatnie wyniki, miejsce w tabeli względem celu i na to, ile razy już prosiłeś w tym sezonie. Odmowa trochę psuje
        relacje, zgoda też kosztuje odrobinę zaufania.
      </p>
    </div>
  )
}

// ---------- trener ----------

export function CoachCard({ s }: { s: GameState }) {
  const next = LICENSES[LICENSES.indexOf(s.coach.license) + 1]
  const course = next ? LICENSE_COURSES[next] : undefined
  const mult = multiplierOf(s)
  const lic = licenseStatus(s)
  return (
    <div className="profile">
      <h2>
        {s.coach.firstName} {s.coach.lastName}
      </h2>
      <p className="muted">
        {s.coach.age} lat · {s.coach.region} · licencja {s.coach.license}
        {s.coach.courseLeft > 0 ? ` (kurs ${next}: jeszcze ${s.coach.courseLeft} ${s.coach.courseLeft === 1 ? 'sezon' : 'sezony'})` : ''}
      </p>
      <div className="bars">
        <Bar label="Stres" value={s.coach.stress} invert />
        <Bar label="Reputacja" value={Math.max(0, Math.min(100, s.coach.reputation))} />
        {(s.burnout ?? 0) > 0 && <Bar label="Wypalenie" value={Math.min(100, Math.round(((s.burnout ?? 0) / BURNOUT_END) * 100))} invert />}
        {(s.dirt ?? 0) > 0 && <Bar label="Teczka w redakcji" value={Math.min(100, Math.round(((s.dirt ?? 0) / DIRT_END) * 100))} invert />}
      </div>
      {((s.burnout ?? 0) > 0 || (s.dirt ?? 0) > 0) && (
        <p className="small muted">
          Wypalenie rośnie, gdy długo grasz pod bardzo wysokim stresem; na 100 lekarz zabiera Ci gwizdek. Teczkę zapełniają afery i obietnice bez pokrycia; pełna trafia
          do gazety i kończy karierę. Obie po sezonie trochę się zmniejszają.
        </p>
      )}
      <dl className="facts">
        <dt>Punkty kariery</dt>
        <dd>
          <b>{careerScore(s).toLocaleString('pl-PL')}</b>
          {mult !== 1 ? ` (mnożnik ×${mult} za start)` : ''}
        </dd>
        <dt>Oszczędności</dt>
        <dd>{formatMoney(s.coach.savings)}</dd>
        <dt>Pensja trenera</dt>
        <dd>{club(s) ? `${formatMoney(s.salary)} za sezon` : 'bez klubu'}</dd>
        <dt>Bilans</dt>
        <dd>
          {s.totalStats.w}Z {s.totalStats.d}R {s.totalStats.l}P · zwolnienia: {s.totalStats.firedCount}
        </dd>
      </dl>
      {lic && !lic.ok && (
        <p className="small warn-text">
          Liga wymaga licencji {lic.need}.{' '}
          {lic.studying
            ? 'Masz zgodę warunkową, bo jesteś na kursie.'
            : 'Klub zgłosił do rozgrywek trenera z licencją „na papierze”. Zapisz się na kurs po sezonie, bo drugi raz związek się nie zgodzi.'}
        </p>
      )}
      {next && course && s.coach.courseLeft === 0 && (
        <p className="small muted">
          Następna licencja: {next}. Kurs kosztuje {formatMoney(course.cost)} i wymaga reputacji {course.rep}. Zapisy po zakończeniu sezonu.
        </p>
      )}
    </div>
  )
}
