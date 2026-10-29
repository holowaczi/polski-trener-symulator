import { LEVELS } from './data'
import { newGame, playWeek, relegationSlots, takeJob, type NewGameInput } from './engine'
import type { ScenarioId } from './goals'
import { startMultiplier } from './score'
import type { GameState } from './types'
import { addModifier, computeTable } from './util'

/** tydzień, od którego przejmujesz klub w „Uratuj klub w 10 kolejek” (I liga ma 34 kolejki) */
export const RESCUE_WEEK = 24

type Who = Pick<NewGameInput, 'firstName' | 'lastName' | 'age' | 'region' | 'seed'>

/** nowa kariera od wyzwania: ten sam świat co przy zwykłym starcie z tym ziarnem */
export function newScenarioGame(who: Who, id: ScenarioId): GameState {
  let s: GameState
  switch (id) {
    case 'b_do_ekstraklasy':
      s = newGame(who)
      break
    case 'beniaminek': {
      const preview = newGame(who)
      const lg = preview.leagues.find((l) => l.level === 9)!
      const weakest = [...lg.teamIds].sort((a, b) => preview.teams[a].strength - preview.teams[b].strength)[0]
      s = newGame({ ...who, license: 'UEFA Pro', teamId: weakest })
      // beniaminek: kadra z I ligi i budżet, który w Ekstraklasie starcza na waciki
      for (const p of s.squad) p.skill = Math.max(10, p.skill - 4)
      s.budget = Math.round(s.budget * 0.4)
      break
    }
    case 'puchar_z_iv': {
      const preview = newGame(who)
      const lg = preview.leagues.find((l) => l.level === 5 && l.region === who.region) ?? preview.leagues.find((l) => l.level === 5)!
      const sorted = [...lg.teamIds].sort((a, b) => preview.teams[b].strength - preview.teams[a].strength)
      s = newGame({ ...who, license: 'UEFA B', teamId: sorted[Math.floor(sorted.length / 2)] })
      break
    }
    case 'uratuj_klub': {
      s = newGame({ ...who, license: 'UEFA A' })
      // świat gra bez Ciebie do 24. kolejki
      s.offers = []
      s.phase = 'season'
      let guard = 0
      while (s.round < RESCUE_WEEK && guard++ < 60) playWeek(s)
      const lg = s.leagues.find((l) => l.level === 8)!
      const table = computeTable(lg)
      // najwyżej ustawiona drużyna w strefie spadkowej: do bezpiecznego miejsca jest kilka punktów
      const last = table[table.length - relegationSlots(s, lg)].teamId
      const t = s.teams[last]
      s.coach.reputation = 40
      takeJob(s, {
        teamId: last,
        teamName: t.name,
        level: t.level,
        leagueName: lg.name,
        goal: 'utrzymanie',
        salary: Math.round((LEVELS[8].salary * 0.8) / 1000) * 1000,
        note: '',
      })
      // zima już była: zostajesz z kadrą, jaką masz
      s.winterWindowDone = true
      s.trust = { board: 45, squad: 45, fans: 35 }
      s.hiringNote = undefined
      addModifier(s, 'Efekt nowej miotły', 1.5, 4)
      s.start = { license: s.coach.license, teamId: last, multiplier: startMultiplier(s, s.coach.license, last) }
      break
    }
  }
  s.scenario = { id, from: s.season }
  return s
}
