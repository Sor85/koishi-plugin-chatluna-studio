import { projectModelEvidence } from '../../src/model-evidence'
import type { LocateStudioPresetExpressionResult } from '../../src/presets'
import type { StudioModelRequestDetail } from '../../src/types'

export type PresetExpressionObservedValueResult =
  | { status: 'matched', value: string, requestCreatedAt: string }
  | { status: 'failed', message: string }

export function resolvePresetExpressionObservedValue(
  located: LocateStudioPresetExpressionResult,
  detail?: StudioModelRequestDetail,
): PresetExpressionObservedValueResult {
  if (located.status === 'failed') return { status: 'failed', message: located.message }
  if (!detail || detail.id !== located.recordId) {
    return { status: 'failed', message: '无法读取对应的模型请求详情。' }
  }
  const message = projectModelEvidence({
    requestBody: detail.requestBody,
    responseBodyRaw: detail.responseBodyRaw,
    responseBodyFormat: detail.responseBodyFormat,
  }).requestMessages.find(({ evidenceId }) => evidenceId === located.evidenceId)
  if (!message || located.range.start < 0 || located.range.end < located.range.start
    || located.range.end > message.text.length) {
    return { status: 'failed', message: '模型请求证据中的表达式范围无效。' }
  }
  return {
    status: 'matched',
    value: message.text.slice(located.range.start, located.range.end),
    requestCreatedAt: detail.createdAt,
  }
}
