import { computed, ref, watch } from 'vue'
import { normalizeModelRequestJsonString, type ModelRequestJsonValueKind } from './json'

/**
 * 一行 JSON 的本地状态：分支展开、长字符串展开、图片预览与行手势守卫。
 *
 * 行手势是这里最容易回归的一处。整行可点，但用户也要能在行内拖选文字复制——
 * 浏览器在拖选结束后仍会派发 click，若不守卫，选完一段文字就顺带把这一行折叠了。
 * 守卫必须按「本次手势是否发生明显位移」判断，不能读全局 Selection：复制后残留的
 * 旧选区会让所有字段行永久点不动，而那种失效在开发机上几乎撞不到。
 */
export const JSON_ROW_DRAG_THRESHOLD_PX = 3

export interface JsonRowPoint {
  clientX: number
  clientY: number
}

export interface ModelRequestJsonRowOptions {
  value: () => unknown
  valueKind: () => ModelRequestJsonValueKind | undefined
  /** 视图层给出的全局「展开长字符串」默认值。 */
  stringsExpanded: () => boolean
  /** 当前行解析出的图片来源；没有图片时为 undefined。 */
  hasImage: () => boolean
  /** 分支的初始展开态。 */
  open: () => boolean
}

export function createModelRequestJsonRow(options: ModelRequestJsonRowOptions) {
  const expanded = ref(options.open())
  const imageView = ref<'image' | 'raw'>('image')
  /** 本行的手动覆盖；undefined 表示跟随全局默认值。 */
  const localStringExpanded = ref<boolean>()
  let pointerOrigin: JsonRowPoint | undefined
  let suppressClick = false

  const stringExpanded = computed(() => {
    // 看图片的 Base64 原文时必须整段展开，否则只能看到被截断的一行。
    if (options.hasImage() && imageView.value === 'raw') return true
    return localStringExpanded.value ?? options.stringsExpanded()
  })

  const expandedString = computed(() => {
    const value = normalizeModelRequestJsonString(String(options.value() ?? ''))
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  })

  // 值换了就回到图片视图：上一条记录留下的「看原文」不该套在新图片上。
  watch(options.value, () => {
    imageView.value = 'image'
  })

  // 全局默认值变化时收回本行的手动覆盖，否则「全部展开」按钮对手动改过的行无效。
  watch(options.stringsExpanded, () => {
    localStringExpanded.value = undefined
  })

  function toggleString() {
    localStringExpanded.value = !stringExpanded.value
  }

  function startPointer(point: JsonRowPoint) {
    pointerOrigin = { clientX: point.clientX, clientY: point.clientY }
    suppressClick = false
  }

  function finishPointer(point: JsonRowPoint) {
    if (!pointerOrigin) return
    const distance = Math.hypot(point.clientX - pointerOrigin.clientX, point.clientY - pointerOrigin.clientY)
    suppressClick = distance > JSON_ROW_DRAG_THRESHOLD_PX
    pointerOrigin = undefined
  }

  function consumeSuppressedClick(): boolean {
    if (!suppressClick) return false
    suppressClick = false
    return true
  }

  /** 整行点击切长字符串：只有字符串行响应，且拖选手势不算点击。 */
  function toggleStringFromRow() {
    if (options.valueKind() !== 'string' || consumeSuppressedClick()) return
    toggleString()
  }

  function toggleBranchFromRow() {
    if (consumeSuppressedClick()) return
    expanded.value = !expanded.value
  }

  return {
    expanded,
    imageView,
    stringExpanded,
    expandedString,
    toggleString,
    startPointer,
    finishPointer,
    consumeSuppressedClick,
    toggleStringFromRow,
    toggleBranchFromRow,
  }
}

/** 图片摘要里的体积。Base64 每四个字符解出三字节，末尾的补位符不计入。 */
export function formatModelRequestJsonImageSize(source: string): string {
  const base64 = source.slice(source.indexOf(',') + 1).replace(/\s/g, '')
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const bytes = Math.max(0, Math.floor(base64.length * 3 / 4) - padding)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
