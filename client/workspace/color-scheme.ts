import { useColorMode } from '@koishijs/client'
import { computed, onBeforeUnmount, watchEffect, type Ref } from 'vue'
import type { StudioAppearance } from '../../src/types'
import { resolveStudioColorMode } from './resolve-color-mode'

// Koishi 已经把控制台的自动主题解析成最终明暗模式；插件的 auto 必须继承该响应式结果，
// 不能再次读取 prefers-color-scheme，否则控制台被用户强制设为深色时 工作室页面仍会跟随操作系统亮色。
// 同时把解析结果同步到 body，供 teleport 到 body 的 Dialog/Popover/Select 面板继承工作区配色。
export function useResolvedColorMode(appearance: Ref<StudioAppearance>): Ref<'light' | 'dark'> {
  const koishiColorMode = useColorMode()
  const resolved = computed<'light' | 'dark'>(() => resolveStudioColorMode(
    appearance.value.studioColorMode,
    koishiColorMode.value,
  ))
  watchEffect(() => {
    document.body.dataset.studioColorScheme = resolved.value
  })
  onBeforeUnmount(() => {
    delete document.body.dataset.studioColorScheme
  })
  return resolved
}

// 毛玻璃开关同样写到 body：teleport 到 body 的 Dialog/Popover/Select/右键菜单
// 和浮动二级页拿不到工作区 DOM 上的状态类，统一由 body[data-chatluna-studio-frosted]
// 驱动实体/雾化双态，避免给每个浮层组件都穿一条 frosted prop 链。
export function useFrostedSurfaceFlag(appearance: Ref<StudioAppearance>): void {
  watchEffect(() => {
    if (appearance.value.enableStudioFrostedGlass) {
      document.body.dataset.studioFrosted = 'true'
    } else {
      delete document.body.dataset.studioFrosted
    }
  })
  onBeforeUnmount(() => {
    delete document.body.dataset.studioFrosted
  })
}
