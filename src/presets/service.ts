import { resolve } from 'node:path'
import { projectModelEvidence } from '../model-evidence'
import { type StudioModelRequestStore } from '../model-request'
import type { StudioModelRequestRecord, StudioPresetRuntimeSnapshot } from '../types'
import { matchPresetExpressionEvidence } from './evidence-match'
import {
  FileSystemPresetRepository,
  PresetRepositoryError,
  type CreatePresetInput,
  type DeletePresetInput,
  type PresetFile,
  type PresetRepository,
  type RenamePresetInput,
  type SavePresetInput,
} from './repository'
import type {
  PresetDocumentKind,
  PresetSourceDiagnostic,
  PresetSourcePath,
  PresetSourceRange,
  PresetTemplateExpression,
  PresetTemplateField,
} from './types'

export interface StudioPresetExpression extends PresetTemplateExpression {
  stableId: string
}

export interface StudioPresetDocument {
  kind: PresetDocumentKind
  fileName: string
  displayName?: string
  source: string
  revision: string
  size: number
  modifiedAt: string
  templateFields: PresetTemplateField[]
  expressions: StudioPresetExpression[]
  diagnostics: PresetSourceDiagnostic[]
}

export interface ReadStudioPresetInput {
  kind: PresetDocumentKind
  fileName: string
}

export interface StudioPresetDocumentIdentity extends ReadStudioPresetInput {
  revision: string
}

export type StudioPresetExpressionIdentity =
  | { stableId: string }
  | {
    path: PresetSourcePath
    range: PresetSourceRange
    occurrence: number
  }

export interface LocateStudioPresetExpressionInput {
  document: StudioPresetDocumentIdentity
  expression: StudioPresetExpressionIdentity
}

export type StudioPresetLocateFailureCode =
  | 'document-not-found'
  | 'document-stale'
  | 'document-identity-unavailable'
  | 'expression-not-found'
  | 'request-not-observed'
  | 'expression-stale'
  | 'expression-not-observed'
  | 'expression-ambiguous'
  | 'expression-unsupported'

export type LocateStudioPresetExpressionResult =
  | {
    status: 'matched'
    recordId: string
    evidenceId: string
    range: PresetSourceRange
  }
  | {
    status: 'failed'
    code: StudioPresetLocateFailureCode
    message: string
    reason?: 'control-tag' | 'template-field'
  }

export interface StudioPresetServiceOptions {
  baseDir: string
  modelRequests: StudioModelRequestStore
  repository?: PresetRepository
}

export class StudioPresetService {
  private readonly repository: PresetRepository

  constructor(private readonly options: StudioPresetServiceOptions) {
    this.repository = options.repository ?? new FileSystemPresetRepository({
      coreRoot: resolve(options.baseDir, 'data/chathub/presets'),
      characterRoot: resolve(options.baseDir, 'data/chathub/character/presets'),
    })
  }

  async catalog(kind?: PresetDocumentKind): Promise<StudioPresetDocument[]> {
    const kinds: PresetDocumentKind[] = kind ? [kind] : ['core', 'character']
    const files = await Promise.all(kinds.map((documentKind) => this.repository.readAll(documentKind)))
    return files.flat().map((file) => this.present(file)).sort((left, right) => (
      left.kind.localeCompare(right.kind)
      || left.displayName?.localeCompare(right.displayName ?? '')
      || left.fileName.localeCompare(right.fileName)
    ))
  }

  async read(input: ReadStudioPresetInput): Promise<StudioPresetDocument> {
    return this.present(await this.repository.read(input.kind, input.fileName))
  }

  async create(input: CreatePresetInput): Promise<StudioPresetDocument> {
    return this.present(await this.repository.create(input))
  }

  async save(input: SavePresetInput): Promise<StudioPresetDocument> {
    return this.present(await this.repository.save(input))
  }

  async rename(input: RenamePresetInput): Promise<StudioPresetDocument> {
    return this.present(await this.repository.rename(input))
  }

  async delete(input: DeletePresetInput): Promise<{ deleted: true }> {
    await this.repository.delete(input)
    return { deleted: true }
  }

  async locateExpression(input: LocateStudioPresetExpressionInput): Promise<LocateStudioPresetExpressionResult> {
    let document: StudioPresetDocument
    try {
      document = await this.read(input.document)
    } catch (error) {
      if (error instanceof PresetRepositoryError && error.code === 'not-found') {
        return failure('document-not-found', error.message)
      }
      throw error
    }
    if (document.revision !== input.document.revision) {
      return failure('document-stale', '预设源码 revision 已变化，请刷新后重试')
    }
    if (!document.displayName) {
      return failure('document-identity-unavailable', '预设缺少可用于运行时关联的展示身份')
    }
    const expression = resolveExpression(document.expressions, input.expression)
    if (!expression) return failure('expression-not-found', '预设表达式不存在或坐标已变化')

    const recordAndSnapshot = await findLatestMatchingRequest(this.options.modelRequests, document)
    if (!recordAndSnapshot) {
      return failure('request-not-observed', '记录库里没有使用该预设当前模板的有归属成功模型请求')
    }

    const { record, snapshot } = recordAndSnapshot
    const result = matchPresetExpressionEvidence({
      document: {
        kind: document.kind,
        source: document.source,
        templateFields: document.templateFields,
        expressions: document.expressions,
        diagnostics: document.diagnostics,
      },
      expression,
      snapshot,
      evidence: projectModelEvidence({
        requestBody: record.requestBody,
        responseBodyRaw: record.responseBodyRaw,
        responseBodyFormat: record.responseBodyFormat,
      }),
    })
    if (result.status === 'matched') {
      return {
        status: 'matched',
        recordId: record.id,
        evidenceId: result.evidenceId,
        range: result.range,
      }
    }
    if (result.status === 'stale') return failure('expression-stale', '表达式或运行时模板已变化')
    if (result.status === 'not-observed') return failure('expression-not-observed', '模型请求证据中未观察到该表达式的展开范围')
    if (result.status === 'ambiguous') return failure('expression-ambiguous', '模型请求证据中存在多个可能范围，无法唯一定位')
    return {
      ...failure('expression-unsupported', '该表达式不能映射为精确模型证据范围'),
      reason: result.reason,
    }
  }

  private present(file: PresetFile): StudioPresetDocument {
    return {
      kind: file.kind,
      fileName: file.fileName,
      displayName: file.document.displayName,
      source: file.source,
      revision: file.revision,
      size: file.size,
      modifiedAt: file.modifiedAt,
      templateFields: structuredClone(file.document.templateFields),
      expressions: file.document.expressions.map((expression) => ({
        ...structuredClone(expression),
        stableId: expressionStableId(expression),
      })),
      diagnostics: structuredClone(file.document.diagnostics),
    }
  }
}

export function expressionStableId(expression: Pick<PresetTemplateExpression, 'path' | 'occurrence'>): string {
  return `${JSON.stringify(expression.path)}#${expression.occurrence}`
}

function resolveExpression(
  expressions: readonly StudioPresetExpression[],
  identity: StudioPresetExpressionIdentity,
): StudioPresetExpression | undefined {
  if ('stableId' in identity) return expressions.find(({ stableId }) => stableId === identity.stableId)
  return expressions.find((expression) => (
    expression.occurrence === identity.occurrence
    && samePath(expression.path, identity.path)
    && expression.range.start === identity.range.start
    && expression.range.end === identity.range.end
  ))
}

async function findLatestMatchingRequest(
  store: StudioModelRequestStore,
  document: StudioPresetDocument,
): Promise<{ record: StudioModelRequestRecord, snapshot: StudioPresetRuntimeSnapshot } | undefined> {
  let beforeSequence: number | undefined
  do {
    const page = await store.getRecords({ attribution: 'attributed', order: 'desc', limit: 200, beforeSequence })
    for (const item of page.records) {
      if (item.status !== 'success' || !item.requestBodyAvailable) continue
      if (!item.presetSnapshotSummaries?.some((snapshot) => (
        snapshot.kind === document.kind && snapshot.presetName === document.displayName
      ))) continue
      const record = await store.getRecord(item.id)
      if (!record || record.requestBody === undefined) continue
      const snapshot = record.presetSnapshots?.find((candidate) => snapshotMatchesDocument(candidate, document))
      if (snapshot) return { record, snapshot }
    }
    beforeSequence = page.nextCursor
    if (!page.hasMore) return
  } while (beforeSequence !== undefined)
}

function snapshotMatchesDocument(snapshot: StudioPresetRuntimeSnapshot, document: StudioPresetDocument): boolean {
  if (snapshot.kind !== document.kind || snapshot.presetName !== document.displayName) return false
  if (snapshot.source === document.source) return true
  if (snapshot.templates.length !== document.templateFields.length) return false
  return document.templateFields.every((field) => snapshot.templates.some((template) => (
    samePath(template.path, field.path) && template.template === field.value
  )))
}

function samePath(left: PresetSourcePath, right: PresetSourcePath): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index])
}

function failure(
  code: StudioPresetLocateFailureCode,
  message: string,
): LocateStudioPresetExpressionResult & { status: 'failed' } {
  return { status: 'failed', code, message }
}
