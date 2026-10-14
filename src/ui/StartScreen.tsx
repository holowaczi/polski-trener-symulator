import { useState } from 'react'
import { REGIONS } from '../game/data'
import { newGame } from '../game/engine'
import { seedFromString } from '../game/rng'
import type { GameState } from '../game/types'

interface Props {
  saved: GameState | null
  onStart: (s: GameState) => void
  onContinue: () => void
}

export function StartScreen({ saved, onStart, onContinue }: Props) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [age, setAge] = useState(32)
  const [region, setRegion] = useState('mazowieckie')
  const [seed, setSeed] = useState('')

  const start = () => {
    const fn = firstName.trim() || 'Janusz'
    const ln = lastName.trim() || 'Trenerski'
    const seedNum = seed.trim() ? seedFromString(seed.trim()) : (Math.random() * 2 ** 32) >>> 0
    onStart(newGame({ firstName: fn, lastName: ln, age, region, seed: seedNum }))
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <main className="start">
      <header className="start-head">
        <div className="logo">⚽</div>
        <h1>Polski Trener Symulator</h1>
        <p className="muted">Od B-klasy do Ekstraklasy. Albo do zwolnienia w trzeciej kolejce.</p>
      </header>

      {saved && (
        <section className="card">
          <h2>Kontynuuj karierę</h2>
          <p>
            {saved.coach.firstName} {saved.coach.lastName}, sezon {saved.season}
            {saved.clubId !== null ? `, ${saved.teams[saved.clubId].name}` : ', bez klubu'}
          </p>
          <button className="primary" onClick={onContinue}>
            Wróć do gry
          </button>
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
          <label className="full">
            Ziarno świata (opcjonalnie)
            <input value={seed} placeholder="puste = losowy świat" onChange={(e) => setSeed(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button className="primary" onClick={start}>
            Zaczynamy karierę
          </button>
          <button onClick={() => setSeed(`wyzwanie-${today}`)}>Wyzwanie dnia</button>
        </div>
        <p className="muted small">
          To samo ziarno daje ten sam świat i te same zdarzenia. „Wyzwanie dnia” to wspólny start dla wszystkich.
        </p>
      </section>
    </main>
  )
}
