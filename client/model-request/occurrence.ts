import { h, type VNode } from 'vue'
import type { ModelRequestConversation } from './conversation'

export interface ModelTextRange {
  start: number
  end: number
}

export interface ModelRequestOccurrence {
  evidenceId: string
  messageTarget: string
  target: string
  range: ModelTextRange
}

const OCCURRENCE_TARGET_SUFFIX = '--content-occurrence'

/**
 * 精确 occurrence 只属于请求消息的语义正文。
 * matcher 的偏移量来自 ModelEvidenceMessage.text，因此这里按同一份 UTF-16 字符串验证，
 * 不把范围套到 reasoning、工具参数、响应或卡片里碰巧出现的其他文字上。
 */
export function resolveModelRequestOccurrence(
  conversation: ModelRequestConversation,
  evidenceId: string,
  range: ModelTextRange,
): ModelRequestOccurrence | undefined {
  const message = conversation.messages.find(candidate => candidate.evidenceId === evidenceId)
  if (!message || message.source !== 'request' || !isValidUtf16Range(message.content, range)) return undefined
  const messageTarget = modelRequestMessageTargetId(evidenceId)
  return {
    evidenceId,
    messageTarget,
    target: modelRequestOccurrenceTargetId(evidenceId),
    range: { ...range },
  }
}

export function isValidUtf16Range(value: string, range: ModelTextRange): boolean {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) return false
  if (range.start < 0 || range.end < range.start || range.end > value.length) return false
  return isUtf16Boundary(value, range.start) && isUtf16Boundary(value, range.end)
}

export function renderModelRequestOccurrence(
  value: string,
  occurrence: Pick<ModelRequestOccurrence, 'target' | 'range'> | undefined,
): string | Array<string | VNode> {
  if (!occurrence) return value
  const { start, end } = occurrence.range
  const mark = h('mark', {
    id: occurrence.target,
    class: [
      'chatluna-studio-model-analysis-occurrence',
      { 'is-caret': start === end },
    ],
    'aria-label': start === end ? '精确文本位置' : '精确文本匹配',
  }, value.slice(start, end))
  return [value.slice(0, start), mark, value.slice(end)]
}

export function modelRequestOccurrenceTargetId(evidenceId: string): string {
  return `${modelRequestMessageTargetId(evidenceId)}${OCCURRENCE_TARGET_SUFFIX}`
}

function modelRequestMessageTargetId(evidenceId: string): string {
  return `model-analysis-${evidenceId}`
}

function isUtf16Boundary(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return true
  const previous = value.charCodeAt(offset - 1)
  const next = value.charCodeAt(offset)
  return !(isHighSurrogate(previous) && isLowSurrogate(next))
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xD800 && unit <= 0xDBFF
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xDC00 && unit <= 0xDFFF
}
