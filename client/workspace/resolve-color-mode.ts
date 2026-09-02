import type { StudioAppearance } from '../../src/types'

export function resolveStudioColorMode(
  mode: StudioAppearance['studioColorMode'],
  koishiColorMode: 'light' | 'dark',
): 'light' | 'dark' {
  return mode === 'auto' ? koishiColorMode : mode
}
