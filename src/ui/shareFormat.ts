import type { EndingKind } from '../game/types'

export type ShareFormat = 'pion' | 'poziom'

/** pion pod Instagram (4:5), poziom pod X (16:9) */
export const SHARE_SIZE: Record<ShareFormat, { w: number; h: number }> = {
  pion: { w: 1080, h: 1350 },
  poziom: { w: 1600, h: 900 },
}

export const ENDING_ICON: Record<EndingKind, string> = {
  decyzja: '👋',
  emerytura: '🏡',
  wypalenie: '🔥',
  skandal: '📰',
  bezrobocie: '🎣',
}
