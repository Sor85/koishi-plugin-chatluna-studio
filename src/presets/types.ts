import type {
  StudioPresetRuntimeSnapshot,
  StudioPresetRuntimeTemplate,
  StudioPresetTemplateRole,
} from '../types'

export type PresetDocumentKind = 'core' | 'character'

export type PresetRuntimeSnapshot = StudioPresetRuntimeSnapshot
export type PresetRuntimeTemplate = StudioPresetRuntimeTemplate
export type PresetTemplateRole = StudioPresetTemplateRole

export type PresetSourcePath = readonly (string | number)[]

export interface PresetSourceRange {
  start: number
  end: number
}

export type PresetTemplateExpressionKind = 'value' | 'control'

export interface PresetTemplateExpression {
  path: PresetSourcePath
  range: PresetSourceRange
  content: string
  kind: PresetTemplateExpressionKind
  clickable: boolean
  occurrence: number
}

export interface PresetTemplateField {
  path: PresetSourcePath
  range: PresetSourceRange
  value: string
}

export type PresetSourceDiagnosticCode =
  | 'yaml-parse-error'
  | 'template-field-not-string'

export interface PresetSourceDiagnostic {
  code: PresetSourceDiagnosticCode
  message: string
  severity: 'error'
  path?: PresetSourcePath
  range?: PresetSourceRange
}

export interface PresetSourceDocument {
  kind: PresetDocumentKind
  source: string
  displayName?: string
  templateFields: PresetTemplateField[]
  expressions: PresetTemplateExpression[]
  diagnostics: PresetSourceDiagnostic[]
}

/**
 * 一次对话轮的归属目标。
 *
 * 真实环境里（机器人，会话）就是完整身份，不再有把同一对参与者分到不同记录域的空间概念。
 */
export interface PresetRuntimeSessionTarget {
  botId: string
  conversationId: string
}

export type PresetEvidenceMatchResult =
  | { status: 'matched', evidenceId: string, range: PresetSourceRange }
  | { status: 'stale' }
  | { status: 'not-observed' }
  | { status: 'ambiguous' }
  | { status: 'unsupported', reason: 'control-tag' | 'template-field' }
