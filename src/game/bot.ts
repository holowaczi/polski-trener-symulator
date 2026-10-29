import { acceptDemand, canNegotiate } from './contracts'
import { acceptOffer, finishTransfers, newGame, playNext, resolveEvent, stayAtClub, startLicenseCourse, waitForOffers } from './engine'
import { acceptBid, buyPlayer } from './market'
import type { GameState } from './types'

/** bot nie bierze urlopu i nie grozi pozwem: chcemy długich karier */
const SAFE_CHOICE: Record<string, number> = { lekarz: 1, dziennikarz: 1 }

/**
 * Prosty bot do testów: rozgrywa karierę aż do podanego sezonu albo emerytury.
 * Zatrzymuje się wcześniej, gdy `stop` zwróci true. Bierze najwyższą ofertę, przedłuża umowy, kupuje najlepszego, na kogo stać.
 */
export function playCareer(s: GameState, untilSeason: number, stop?: (s: GameState) => boolean): GameState {
  let guard = 0
  while (s.phase !== 'retired' && s.season <= untilSeason && !stop?.(s) && guard++ < 50000) {
    switch (s.phase) {
      case 'hiring': {
        if (!s.offers.length) {
          waitForOffers(s)
          break
        }
        const best = [...s.offers].sort((a, b) => b.level - a.level)[0]
        acceptOffer(s, best.teamId)
        break
      }
      case 'transfer': {
        for (const pl of [...s.squad].sort((x, y) => y.skill - x.skill)) if (canNegotiate(pl) && pl.age < 34) acceptDemand(s, pl.id)
        const target = s.transferList.filter((t) => t.fee <= s.budget).sort((a, b) => b.player.skill - a.player.skill)[0]
        if (target && s.squad.length < 24) buyPlayer(s, target.player.id)
        if (s.bids[0] && guard % 2) acceptBid(s, s.bids[0].playerId)
        finishTransfers(s)
        break
      }
      case 'event':
        resolveEvent(s, SAFE_CHOICE[s.pendingEvent!.eventId] ?? guard % s.pendingEvent!.options.length)
        break
      case 'season':
        playNext(s)
        break
      case 'seasonEnd': {
        if (s.clubId === null && !s.offers.length) {
          waitForOffers(s)
          break
        }
        startLicenseCourse(s)
        const better = s.offers.filter((o) => o.level > (s.clubId ? s.teams[s.clubId].level : -1))
        if (better.length) acceptOffer(s, better[0].teamId)
        else if (s.clubId !== null) stayAtClub(s)
        // bez wymaganej licencji nie da się zostać: bierzemy pierwszą ofertę
        if ((s.phase as string) === 'seasonEnd') acceptOffer(s, s.offers[0].teamId)
        break
      }
    }
  }
  return s
}

export function botCareer(seed: number, region: string, untilSeason: number): GameState {
  return playCareer(newGame({ firstName: 'T', lastName: 'B', age: 30, region, seed }), untilSeason)
}
