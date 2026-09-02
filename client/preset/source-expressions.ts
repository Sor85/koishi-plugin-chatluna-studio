import { parsePresetSourceDocument } from '../../src/presets/source-document'
import type {
  PresetDocumentKind,
  PresetTemplateExpression,
} from '../../src/presets/types'

export interface PresetSourceEditorExpression extends PresetTemplateExpression {
  stableId?: string
}

export function codeMirrorOffset(source: string, sourceOffset: number) {
  const limit = Math.max(0, Math.min(source.length, sourceOffset))
  let offset = limit
  for (let index = 0; index < limit; index += 1) {
    if (source[index] === '\r' && source[index + 1] === '\n') offset -= 1
  }
  return offset
}

export interface ResolvePresetSourceExpressionsInput {
  kind: PresetDocumentKind
  source: string
  loadedSource: string
  serverExpressions: readonly PresetSourceEditorExpression[]
}

export function resolvePresetSourceExpressions(
  input: ResolvePresetSourceExpressionsInput,
): readonly PresetSourceEditorExpression[] {
  if (input.source === input.loadedSource) return input.serverExpressions

  return parsePresetSourceDocument(input.kind, input.source).expressions.map((expression) => ({
    ...expression,
    clickable: false,
  }))
}
