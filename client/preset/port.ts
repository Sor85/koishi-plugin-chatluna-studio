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

/**
 * 预设文件的客户端 seam。与工作区端口分开：预设是全局 ChatLuna 资源，输入里只有文档种类、
 * 文件名与修订，没有任何场景概念。
 *
 * 它的适配器不注入当前观察空间：预设文件是全局的，仅定位表达式那一个方法的输入自身携带
 * 明确的 scope，由调用方给出。
 */
export interface PresetPort {
  getPresetCatalog(input?: { kind?: PresetDocumentKind }): Promise<StudioPresetDocument[]>
  readPreset(input: ReadStudioPresetInput): Promise<StudioPresetDocument>
  createPreset(input: CreatePresetInput): Promise<StudioPresetDocument>
  savePreset(input: SavePresetInput): Promise<StudioPresetDocument>
  renamePreset(input: RenamePresetInput): Promise<StudioPresetDocument>
  deletePreset(input: DeletePresetInput): Promise<{ deleted: true }>
  locatePresetExpression(input: LocateStudioPresetExpressionInput): Promise<LocateStudioPresetExpressionResult>
}

export type PresetPortOperation = keyof PresetPort
