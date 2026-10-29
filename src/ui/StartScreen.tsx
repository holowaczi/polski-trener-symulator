import { useMemo, useState } from 'react'
import { LEVELS, REGIONS } from '../game/data'
import { newGame } from '../game/engine'
import { seedFromString } from '../game/rng'
import { licenseCovers, START_LICENSES, startMultiplier } from '../game/score'
import type { GameState, License } from '../game/types'
import { bottomLevel, leagueOf } from '../game/world'
import { teamRegion } from '../game/regions'
import { HowToPlay } from './help'
import { BADGES, SCENARIOS, type ScenarioId } from '../game/goals'
import { newScenarioGame } from '../game/scenarioStart'
import { brokenSaveText, downloadText, exportFileName, exportSave, importSave, loadBadges, loadRecords, loadScenarioRecords } from './save'

interface Props {
  saved: GameState | null
  /** zapis był, ale się nie wczytał */
  loadProblem?: string
  onStart: (s: GameState) => void
  onContinue: () => void
}

export function StartScreen({ saved, loadProblem, onStart, onContinue }: Props) {
  const [importProblem, setImportProblem] = useState<string | undefined>()
  const [help, setHelp] = useState(false)
  const broken = useMemo(() => (loadProblem ? brokenSaveText() : null), [loadProblem])

  const importFile = async (file: File | undefined) => {
    if (!file) return
    const r = importSave(await file.text())
    if (!r.state) {
      setImportProblem(r.problem)
      return
    }
    if (saved && saved.phase !== 'retired' && !window.confirm('Wczytanie kopii zastąpi karierę zapisaną w tej przeglądarce. Wczytać?')) return
    onStart(r.state)
  }

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [age, setAge] = useState(32)
  const [region, setRegion] = useState('mazowieckie')
  const [seed, setSeed] = useState('')
  const [randomSeed] = useState(() => (Math.random() * 2 ** 32) >>> 0)
  const [license, setLicense] = useState<License>('UEFA C')
  /** -1 = zwykły start z ofertami z najniższej klasy */
  const [level, setLevel] = useState(-1)
  const [teamId, setTeamId] = useState<number | undefined>(undefined)

  const today = new Date().toISOString().slice(0, 10)
  const daily = seed.trim().startsWith('wyzwanie-')
  const seedNum = seed.trim() ? seedFromString(seed.trim()) : randomSeed
  // podgląd świata z tym samym ziarnem: te same kluby pojawią się po starcie
  const preview = useMemo(() => newGame({ firstName: 'x', lastName: 'x', age: 30, region, seed: seedNum }), [region, seedNum])
  const levels = useMemo(() => {
    const out: { level: number; name: string }[] = []
    for (let lv = LEVELS.length - 1; lv >= bottomLevel(preview); lv--) {
      const lg = preview.leagues.find((l) => l.level === lv)
      if (lg) out.push({ level: lv, name: lv === 6 ? lg.name : lg.group ? lg.name.split(' · ')[0] : lg.name.replace(/ \(.*\)$/, '') })
    }
    return out
  }, [preview])
  const clubs = useMemo(() => {
    if (level < 0) return []
    // województwo wyznacza kluby na start: od III ligi w dół tylko te z regionu
    return preview.leagues
      .filter((l) => l.level === level && (l.level > 5 || l.region === region))
      .flatMap((l) => l.teamIds)
      .filter((id) => level !== 6 || teamRegion(preview, id) === region)
      .sort((a, b) => preview.teams[b].strength - preview.teams[a].strength)
  }, [preview, level])

  const pickedTeam = !daily && level >= 0 && teamId !== undefined && clubs.includes(teamId) ? teamId : undefined
  const pickedLicense: License = daily ? 'UEFA C' : license
  const multiplier = startMultiplier(preview, pickedLicense, pickedTeam)
  const records = useMemo(() => loadRecords(), [])
  const scenarioRecords = useMemo(() => loadScenarioRecords(), [])
  const badges = useMemo(() => loadBadges(), [])

  const changeLicense = (l: License) => {
    setLicense(l)
    if (level >= 0 && !licenseCovers(l, level)) {
      setLevel(-1)
      setTeamId(undefined)
    }
  }
  const changeLevel = (lv: number) => {
    setLevel(lv)
    setTeamId(undefined)
  }

  const who = () => ({ firstName: firstName.trim() || 'Janusz', lastName: lastName.trim() || 'Trenerski', age, region, seed: seedNum })
  const start = () => onStart(newGame({ ...who(), license: pickedLicense, teamId: pickedTeam, daily }))
  const startScenario = (id: ScenarioId) => onStart(newScenarioGame(who(), id))

  return (
    <main className="start">
      <header className="start-head">
        <div className="logo">⚽</div>
        <h1>Polski Trener Symulator</h1>
        <p className="muted">Od C-klasy do Ekstraklasy. Albo do zwolnienia w trzeciej kolejce.</p>
        <p className="muted small">Prawdziwe kluby sezonu 2026/27, od Ekstraklasy po B-klasę. Województwo decyduje o grupie III ligi i o lokalnych ligach.</p>
        <button className="ghost" onClick={() => setHelp(true)}>
          📖 Jak grać
        </button>
      </header>
      {help && <HowToPlay onClose={() => setHelp(false)} />}

      {loadProblem && (
        <section className="card save-problem" role="alert">
          <h2>Kłopot z zapisem</h2>
          <p>{loadProblem}</p>
          {broken && (
            <button onClick={() => downloadText('zapis-do-ratowania.json', broken)}>Pobierz ten zapis</button>
          )}
        </section>
      )}

      {saved && saved.phase !== 'retired' && (
        <section className="card">
          <h2>Kontynuuj karierę</h2>
          <p>
            {saved.coach.firstName} {saved.coach.lastName}, sezon {saved.season}
            {saved.clubId !== null ? `, ${saved.teams[saved.clubId].name}` : ', bez klubu'}
          </p>
          <div className="row">
            <button className="primary" onClick={onContinue}>
              Wróć do gry
            </button>
            <button onClick={() => downloadText(exportFileName(saved), exportSave(saved))}>💾 Pobierz kopię</button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Nowy trener</h2>
        <div className="form">
          <label>
            Imię
            <input value={firstName} placeholder="Janusz" onChange={(e) => setFirstName(e.target.value)} />
          </label>
          <label>
            Nazwisko
            <input value={lastName} placeholder="Trenerski" onChange={(e) => setLastName(e.target.value)} />
          </label>
          <label>
            Wiek
            <select value={age} onChange={(e) => setAge(Number(e.target.value))}>
              {Array.from({ length: 21 }, (_, i) => 25 + i).map((a) => (
                <option key={a} value={a}>
                  {a} lat
                </option>
              ))}
            </select>
          </label>
          <label>
            Województwo
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            Licencja na start
            <select value={pickedLicense} disabled={daily} onChange={(e) => changeLicense(e.target.value as License)}>
              {START_LICENSES.map((l) => (
                <option key={l.license} value={l.license}>
                  {l.license} (×{l.factor})
                </option>
              ))}
            </select>
          </label>
          <label>
            Poziom startu
            <select value={daily ? -1 : level} disabled={daily} onChange={(e) => changeLevel(Number(e.target.value))}>
              <option value={-1}>Oferty z najniższej klasy</option>
              {levels.map((l) => (
                <option key={l.level} value={l.level} disabled={!licenseCovers(pickedLicense, l.level)}>
                  {l.name}
                  {licenseCovers(pickedLicense, l.level) ? '' : ` (wymaga ${LEVELS[l.level].license})`}
                </option>
              ))}
            </select>
          </label>
          {!daily && level >= 0 && (
            <label className="full">
              Klub
              <select value={pickedTeam ?? ''} onChange={(e) => setTeamId(e.target.value === '' ? undefined : Number(e.target.value))}>
                <option value="">Wybierz klub</option>
                {clubs.map((id) => {
                  const lg = leagueOf(preview, id)
                  return (
                    <option key={id} value={id}>
                      {preview.teams[id].name}
                      {lg?.group ? ` · ${lg.group}` : ''}
                    </option>
                  )
                })}
              </select>
            </label>
          )}
          <label className="full">
            Ziarno świata (opcjonalnie)
            <input value={seed} placeholder="puste = losowy świat" onChange={(e) => setSeed(e.target.value)} />
          </label>
        </div>
        <p className="multiplier">
          Mnożnik punktów kariery: <b>×{multiplier}</b>
          {daily
            ? ' · wyzwanie dnia: zwykły start dla wszystkich'
            : level >= 0 && pickedTeam === undefined
              ? ' · wybierz klub'
              : multiplier === 1
                ? ' · klasyczny start'
                : ' · łatwiejszy start, mniej punktów'}
        </p>
        <div className="row">
          <button className="primary" onClick={start} disabled={!daily && level >= 0 && pickedTeam === undefined}>
            Zaczynamy karierę
          </button>
          <button onClick={() => setSeed(`wyzwanie-${today}`)}>Wyzwanie dnia</button>
        </div>
        <p className="muted small">
          To samo ziarno daje ten sam świat i te same zdarzenia. „Wyzwanie dnia” to wspólny start dla wszystkich. Przy wybranym klubie liczy się też jego pozycja: faworyt ligi daje mniej punktów, outsider trochę więcej.
        </p>
      </section>

      <section className="card">
        <h2>Kopia z pliku</h2>
        <p className="muted small">Masz kopię kariery z innego telefonu albo sprzed czyszczenia przeglądarki? Wczytaj ją tutaj.</p>
        <label className="file-button">
          📂 Wczytaj karierę z pliku
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              setImportProblem(undefined)
              void importFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        {importProblem && (
          <p className="warn-text" role="alert">
            {importProblem}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Wyzwania</h2>
        <p className="muted small">Gotowe starty z jednym celem. Imię, wiek, województwo i ziarno bierzemy z formularza wyżej. Po wyzwaniu kariera toczy się dalej.</p>
        <div className="scenarios">
          {SCENARIOS.map((sc) => {
            const runs = scenarioRecords.filter((r) => r.id === sc.id)
            const best = runs.filter((r) => r.won).sort((a, b) => a.seasons - b.seasons)[0]
            return (
              <div key={sc.id} className={`scenario ${best ? 'done' : ''}`}>
                <div className="scenario-head">
                  <span aria-hidden="true">{sc.icon}</span> <b>{sc.title}</b>
                </div>
                <p className="small">{sc.desc}</p>
                <div className="row">
                  <button onClick={() => startScenario(sc.id)}>Podejmij wyzwanie</button>
                  {runs.length > 0 && (
                    <span className="small muted">
                      {best ? `✅ zaliczone${sc.seasons > 1 ? ` (najszybciej: ${best.seasons} ${best.seasons === 1 ? 'sezon' : 'sez.'})` : ''}` : '❌ jeszcze nie'} · prób: {runs.length}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="card">
        <details className="badges-box">
          <summary>
            <h2>
              Odznaki <span className="muted small">{badges.length}/{BADGES.length}</span>
            </h2>
            {badges.length ? (
              <span className="badges-got" aria-hidden="true">
                {BADGES.filter((b) => badges.includes(b.id))
                  .map((b) => b.icon)
                  .join(' ')}
              </span>
            ) : (
              <span className="small muted">Jeszcze żadnej. Stuknij, żeby zobaczyć, za co można je zdobyć.</span>
            )}
          </summary>
        <ul className="badges">
          {BADGES.map((b) => (
            <li key={b.id} className={badges.includes(b.id) ? 'got' : ''} title={b.desc}>
              <span className="badge-icon" aria-hidden="true">
                {b.icon}
              </span>
              <span>
                <b>{b.name}</b>
                <br />
                <span className="small muted">{b.desc}</span>
              </span>
            </li>
          ))}
        </ul>
        </details>
      </section>

      {records.length > 0 && (
        <section className="card">
          <h2>Twoje rekordy</h2>
          <ol className="records">
            {records.map((r, i) => (
              <li key={i}>
                <b>{r.score.toLocaleString('pl-PL')} pkt</b> · {r.name} · {r.peak} · ×{r.multiplier}
                {r.daily ? ' · wyzwanie dnia' : ''}
                {r.scenario ? ` · ${r.scenario}` : ''} <span className="muted small">{r.date}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <footer className="card disclaimer muted">
        <p>
          <b>Gra fanowska.</b> Wszyscy zawodnicy i działacze są fikcyjni, a zbieżność nazwisk jest przypadkowa. Wersja{' '}
          {__APP_VERSION__.replace('-alpha', ' (alfa)')}.
        </p>
        <details>
          <summary>Pełne zastrzeżenie</summary>
        <p>
          Polski Trener Symulator to niekomercyjna gra fanowska, stworzona dla rozrywki. Nie jest powiązana z PZPN, wojewódzkimi związkami piłki nożnej,
          Ekstraklasą S.A. ani żadnym klubem, nie jest też przez nie autoryzowana ani wspierana.
        </p>
        <p>
          Nazwy klubów, lig i rozgrywek pojawiają się wyłącznie w celach informacyjnych, żeby oddać strukturę polskiej piłki. Wszelkie znaki towarowe i nazwy
          należą do ich właścicieli. Gra nie używa herbów, logotypów ani oficjalnych materiałów.
        </p>
        <p>
          Wszyscy zawodnicy, trenerzy, prezesi, działacze i ich wypowiedzi są fikcyjni i generowani losowo. Zbieżność imion i nazwisk z prawdziwymi osobami jest
          przypadkowa. Zdarzenia w grze, w tym humorystyczne, nie opisują prawdziwych osób ani klubów i nie są oceną ich działalności. Wyniki, siła drużyn,
          budżety i pensje są zmyślone.
        </p>
        <p>
          Gra działa w całości w przeglądarce. Zapis kariery trzymamy tylko w pamięci Twojej przeglądarki (localStorage) i nie wysyłamy go nigdzie. Kopię w pliku pobierasz sam i sam decydujesz, gdzie ją trzymasz.
        </p>
        </details>
      </footer>
    </main>
  )
}
