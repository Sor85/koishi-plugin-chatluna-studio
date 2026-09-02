import type {
  CreatePresetInput,
  DeletePresetInput,
  LocateStudioPresetExpressionInput,
  LocateStudioPresetExpressionResult,
  PresetDocumentKind,
  ReadStudioPresetInput,
  RenamePresetInput,
  StudioPresetDocument,
  SavePresetInput,
} from '../../src/presets'
import { FakePortRecorder } from '#client/shared/fake-port-recorder'
import type { PresetPort, PresetPortOperation } from './port'

/** 内存预设端口。目录可写，读取按种类与文件名从目录里兜，写操作按输入合成一份文档。 */
export class FakePresetPort implements PresetPort {
  presetCatalogResult: StudioPresetDocument[] = []
  presetDocumentResult?: StudioPresetDocument
  locatePresetExpressionResult: LocateStudioPresetExpressionResult = {
    status: 'failed',
    code: 'request-not-observed',
    message: '没有匹配的模型请求',
  }
  private readonly recorder = new FakePortRecorder<PresetPortOperation>()

  get calls() {
    return this.recorder.calls
  }

  rejectNext(operation: PresetPortOperation, error: unknown) {
    this.recorder.rejectNext(operation, error)
  }

  private invoke<T>(operation: PresetPortOperation, input: unknown, result: T): Promise<T> {
    return this.recorder.invoke(operation, input, result)
  }

  getPresetCatalog(input: { kind?: PresetDocumentKind } = {}) {
    const result = input.kind
      ? this.presetCatalogResult.filter(({ kind }) => kind === input.kind)
      : this.presetCatalogResult
    return this.invoke('getPresetCatalog', input, result)
  }

  readPreset(input: ReadStudioPresetInput) {
    const document = this.presetCatalogResult.find(({ kind, fileName }) => kind === input.kind && fileName === input.fileName)
      ?? this.presetDocumentResult
    if (!document) this.rejectNext('readPreset', new Error('预设不存在'))
    return this.invoke('readPreset', input, document as StudioPresetDocument)
  }

  createPreset(input: CreatePresetInput) {
    const result = this.presetDocumentResult ?? fakePresetDocument(input)
    return this.invoke('createPreset', input, result)
  }

  savePreset(input: SavePresetInput) {
    const result = this.presetDocumentResult ?? fakePresetDocument(input)
    return this.invoke('savePreset', input, result)
  }

  renamePreset(input: RenamePresetInput) {
    const current = this.presetDocumentResult
      ?? this.presetCatalogResult.find(({ kind, fileName }) => kind === input.kind && fileName === input.fileName)
    const result = current ? { ...current, fileName: input.newFileName } : fakePresetDocument({
      kind: input.kind,
      fileName: input.newFileName,
      source: '',
    })
    return this.invoke('renamePreset', input, result)
  }

  deletePreset(input: DeletePresetInput) {
    return this.invoke('deletePreset', input, { deleted: true } as const)
  }

  locatePresetExpression(input: LocateStudioPresetExpressionInput) {
    return this.invoke('locatePresetExpression', input, this.locatePresetExpressionResult)
  }
}

function fakePresetDocument(input: CreatePresetInput): StudioPresetDocument {
  return {
    ...input,
    revision: `revision:${input.source}`,
    size: input.source.length,
    modifiedAt: '2026-08-22T00:00:00.000Z',
    templateFields: [],
    expressions: [],
    diagnostics: [],
  }
}

export function createFakePresetPort() {
  return new FakePresetPort()
}
