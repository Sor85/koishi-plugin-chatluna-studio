import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  createModelRequestJsonRow,
  formatModelRequestJsonImageSize,
  JSON_ROW_DRAG_THRESHOLD_PX,
} from '../client/model-request/json-row'
import type { ModelRequestJsonValueKind } from '../client/model-request/json'

function harness(overrides: {
  value?: unknown
  valueKind?: ModelRequestJsonValueKind
  stringsExpanded?: boolean
  hasImage?: boolean
  open?: boolean
} = {}) {
  const value = ref<unknown>('value' in overrides ? overrides.value : '一段很长的字符串')
  const valueKind = ref<ModelRequestJsonValueKind | undefined>(overrides.valueKind ?? 'string')
  const stringsExpanded = ref(overrides.stringsExpanded ?? false)
  const hasImage = ref(overrides.hasImage ?? false)
  const row = createModelRequestJsonRow({
    value: () => value.value,
    valueKind: () => valueKind.value,
    stringsExpanded: () => stringsExpanded.value,
    hasImage: () => hasImage.value,
    open: () => overrides.open ?? true,
  })
  return { row, value, valueKind, stringsExpanded, hasImage }
}

describe('JSON 行的字符串展开与图片预览', () => {
  it('默认跟随全局展开设置，手动切换后本行按自己的状态走', () => {
    const collapsed = harness({ stringsExpanded: false })
    expect(collapsed.row.stringExpanded.value).toBe(false)
    collapsed.row.toggleString()
    expect(collapsed.row.stringExpanded.value).toBe(true)
    collapsed.row.toggleString()
    expect(collapsed.row.stringExpanded.value).toBe(false)

    const opened = harness({ stringsExpanded: true })
    expect(opened.row.stringExpanded.value).toBe(true)
    opened.row.toggleString()
    expect(opened.row.stringExpanded.value).toBe(false)
  })

  it('全局展开设置变化时收回本行的手动覆盖', async () => {
    const { row, stringsExpanded } = harness({ stringsExpanded: true })

    row.toggleString()
    expect(row.stringExpanded.value).toBe(false)

    stringsExpanded.value = false
    await nextTick()
    stringsExpanded.value = true
    await nextTick()

    expect(row.stringExpanded.value).toBe(true)
  })

  it('看图片原文时字符串强制整段展开，切回图片视图后恢复原状', () => {
    const { row } = harness({ hasImage: true, stringsExpanded: false })

    expect(row.stringExpanded.value).toBe(false)
    row.imageView.value = 'raw'
    expect(row.stringExpanded.value).toBe(true)

    row.imageView.value = 'image'
    expect(row.stringExpanded.value).toBe(false)
  })

  it('值换了就回到图片视图，上一条留下的看原文不套在新图片上', async () => {
    const { row, value } = harness({ hasImage: true })

    row.imageView.value = 'raw'
    value.value = '换成另一张图'
    await nextTick()

    expect(row.imageView.value).toBe('image')
  })

  it('展开的字符串重新加引号，反斜杠与引号照转义规则显示', () => {
    const { row } = harness({ value: '第一行\n第二行 "引号" 与 \\ 反斜杠' })

    expect(row.expandedString.value).toBe('"第一行\n第二行 \\"引号\\" 与 \\\\ 反斜杠"')
  })

  it('展开时把多行内容的公共缩进抹平，制表符换成两个空格', () => {
    const { row } = harness({ value: 'role:\n    line one\n    line two' })

    expect(row.expandedString.value).toBe('"role:\nline one\nline two"')
    expect(harness({ value: 'a\tb' }).row.expandedString.value).toBe('"a  b"')
  })

  it('缺省值展开成空字符串而不是 undefined 字样', () => {
    const { row } = harness({ value: undefined })

    expect(row.expandedString.value).toBe('""')
  })
})

describe('JSON 行手势守卫', () => {
  it('原地点击照常切换字符串与分支', () => {
    const { row } = harness()

    row.startPointer({ clientX: 100, clientY: 100 })
    row.finishPointer({ clientX: 100, clientY: 100 })
    row.toggleStringFromRow()
    expect(row.stringExpanded.value).toBe(true)

    row.startPointer({ clientX: 100, clientY: 100 })
    row.finishPointer({ clientX: 100, clientY: 100 })
    row.toggleBranchFromRow()
    expect(row.expanded.value).toBe(false)
  })

  it('阈值内的漂移仍算点击', () => {
    const { row } = harness()

    row.startPointer({ clientX: 100, clientY: 100 })
    row.finishPointer({ clientX: 100 + JSON_ROW_DRAG_THRESHOLD_PX, clientY: 100 })
    row.toggleStringFromRow()

    expect(row.stringExpanded.value).toBe(true)
  })

  it('明显位移的拖选不算点击，且只吃掉紧随其后的那一次', () => {
    const { row } = harness()

    row.startPointer({ clientX: 100, clientY: 100 })
    row.finishPointer({ clientX: 200, clientY: 100 })
    row.toggleStringFromRow()
    expect(row.stringExpanded.value).toBe(false)

    // 下一次点击必须照常生效：守卫按本次手势判断，不看残留选区。
    row.toggleStringFromRow()
    expect(row.stringExpanded.value).toBe(true)
  })

  it('斜向拖选按直线距离判定，不是只看横向位移', () => {
    const { row } = harness()

    row.startPointer({ clientX: 100, clientY: 100 })
    row.finishPointer({ clientX: 103, clientY: 103 })
    row.toggleBranchFromRow()

    expect(row.expanded.value).toBe(true)
  })

  it('没有按下过指针时的抬起不留下抑制标记', () => {
    const { row } = harness()

    row.finishPointer({ clientX: 900, clientY: 900 })

    expect(row.consumeSuppressedClick()).toBe(false)
  })

  it('非字符串行的整行点击不切换任何展开态', () => {
    const { row } = harness({ valueKind: 'number', value: 42 })

    row.toggleStringFromRow()

    expect(row.stringExpanded.value).toBe(false)
  })
})

describe('JSON 图片摘要体积', () => {
  it('按 Base64 长度折算字节，补位符不计入', () => {
    expect(formatModelRequestJsonImageSize('data:image/png;base64,AAAA')).toBe('3 B')
    expect(formatModelRequestJsonImageSize('data:image/png;base64,AAA=')).toBe('2 B')
    expect(formatModelRequestJsonImageSize('data:image/png;base64,AA==')).toBe('1 B')
  })

  it('按数量级切换 B、KB、MB', () => {
    expect(formatModelRequestJsonImageSize(`data:image/png;base64,${'A'.repeat(4096)}`)).toBe('3.0 KB')
    expect(formatModelRequestJsonImageSize(`data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`)).toBe('3.0 MB')
  })

  it('容忍裸 Base64 与其中的换行', () => {
    expect(formatModelRequestJsonImageSize('AAAA')).toBe('3 B')
    expect(formatModelRequestJsonImageSize('data:image/png;base64,AA\nAA')).toBe('3 B')
  })
})
