import { markRaw, readonly, ref, shallowRef, type DeepReadonly } from 'vue'
import type {
  CreatePresetInput,
  DeletePresetInput,
  LocateStudioPresetExpressionInput,
  LocateStudioPresetExpressionResult,
  ReadStudioPresetInput,
  RenamePresetInput,
  SavePresetInput,
  StudioPresetDocument,
} from '../../src/presets'
import type {
  StudioAppearance,
  StudioModelRequestDetail,
  StudioModelRequestFacets,
  StudioModelRequestListItem,
  StudioModelRequestTrajectory,
  StudioPersistenceStatus,
} from '../../src/types'
import type { ModelRequestPort } from '#client/model-request/port'
import type { PresetPort } from '#client/preset/port'
import {
  emptyModelRequestCapacity,
  emptyModelRequestFacets,
  type ModelRequestRecordQuery,
  type ModelRequestRecordsPageState,
  type ModelRequestRecordsQuery,
  type ModelRequestTrajectoryQuery,
} from '#client/model-request/query'
import { defaultFakeAppearance, defaultFakePersistence } from './fake-port'
import type { WorkspacePort } from './port'

/**
 * 工作区控制器：三个端口之上的一层状态与动作。
 *
 * 它不认识 Vue 之外的任何环境，也不碰 DOM：全部失败都被规范成一句话抛出，由错误闸门决定
 * 写到哪个区域的错误位上（见 `region-read-gate`）。「读到的东西存在哪」由这里持有，
 * 「读失败时界面怎么表现」不在这里。
 */

export interface StudioWorkspacePorts {
  workspace: WorkspacePort
  modelRequest: ModelRequestPort
  preset: PresetPort
}

class WorkspaceControllerError extends Error {}

function workspaceErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function normalizeWorkspaceError(error: unknown, fallback: string) {
  return new WorkspaceControllerError(workspaceErrorMessage(error, fallback))
}

export function createWorkspaceController(ports: StudioWorkspacePorts) {
  const appearanceState = ref<StudioAppearance>({ ...defaultFakeAppearance })
  const persistenceState = ref<StudioPersistenceStatus>({ ...defaultFakePersistence })
  const modelRequestRecordsState = ref<StudioModelRequestListItem[]>([])
  const modelRequestRecordState = ref<StudioModelRequestDetail>()
  /**
   * 轨迹载荷整份替换、从不原地改，因此不进深响应式。
   *
   * 一条会话轨迹带着上千条组成分段与上百条账本行；用 `ref` 的话每个被读到的分段和行都要各建
   * 一个只读代理，而这份数据的唯一变化方式就是被下一次读取整份换掉。浅引用加 `markRaw`
   * 让「换了一份」照样触发重算，省掉的是那上千个代理。
   */
  const modelRequestTrajectoryState = shallowRef<StudioModelRequestTrajectory>()
  const modelRequestFacetsState = ref<StudioModelRequestFacets>(emptyModelRequestFacets)
  const modelRequestRecordsPageState = ref<ModelRequestRecordsPageState>({
    hasMore: false,
    capacity: emptyModelRequestCapacity,
  })
  const presetCatalogState = ref<StudioPresetDocument[]>([])
  const presetDocumentState = ref<StudioPresetDocument>()

  async function loadWorkspace() {
    try {
      const state = await ports.workspace.getWorkspace()
      appearanceState.value = state.appearance
      persistenceState.value = state.persistence
    } catch (error) {
      throw normalizeWorkspaceError(error, '读取工作区状态失败')
    }
  }

  async function loadModelRequestRecords(input: ModelRequestRecordsQuery, mode: 'replace' | 'append' = 'replace') {
    try {
      const page = await ports.modelRequest.getModelRequestRecords(input)
      modelRequestRecordsState.value = mode === 'append'
        ? [...modelRequestRecordsState.value, ...page.records]
        : page.records
      modelRequestRecordsPageState.value = {
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        earliestCursor: page.earliestCursor,
        capacity: page.capacity,
      }
    } catch (error) {
      throw normalizeWorkspaceError(error, '读取模型请求记录失败')
    }
  }

  async function loadModelRequestRecord(input: ModelRequestRecordQuery) {
    try {
      modelRequestRecordState.value = await ports.modelRequest.getModelRequestRecord(input)
      return modelRequestRecordState.value
    } catch (error) {
      throw normalizeWorkspaceError(error, '读取模型请求详情失败')
    }
  }

  async function loadModelRequestTrajectory(input: ModelRequestTrajectoryQuery) {
    try {
      // markRaw：这份载荷只被整份替换，代理它等于为上千条分段各建一个代理却没有任何一次写入。
      modelRequestTrajectoryState.value = markRaw(await ports.modelRequest.getModelRequestTrajectory(input))
    } catch (error) {
      throw normalizeWorkspaceError(error, '读取模型请求轨迹失败')
    }
  }

  async function loadModelRequestFacets() {
    try {
      modelRequestFacetsState.value = await ports.modelRequest.getModelRequestFacets()
    } catch (error) {
      throw normalizeWorkspaceError(error, '读取模型请求筛选项失败')
    }
  }

  async function clearModelRequestRecords() {
    try {
      await ports.modelRequest.clearModelRequestRecords()
      modelRequestRecordsState.value = []
      modelRequestRecordState.value = undefined
      modelRequestTrajectoryState.value = undefined
      modelRequestFacetsState.value = emptyModelRequestFacets
      modelRequestRecordsPageState.value = { hasMore: false, capacity: emptyModelRequestCapacity }
    } catch (error) {
      throw normalizeWorkspaceError(error, '清理模型请求记录失败')
    }
  }

  async function loadPresetCatalog() {
    try {
      presetCatalogState.value = await ports.preset.getPresetCatalog()
    } catch (error) {
      throw normalizeWorkspaceError(error, '读取预设目录失败')
    }
  }

  async function readPreset(input: ReadStudioPresetInput) {
    try {
      presetDocumentState.value = await ports.preset.readPreset(input)
      return presetDocumentState.value
    } catch (error) {
      throw normalizeWorkspaceError(error, '读取预设失败')
    }
  }

  async function createPreset(input: CreatePresetInput) {
    try {
      const document = await ports.preset.createPreset(input)
      upsertPreset(document)
      presetDocumentState.value = document
      return document
    } catch (error) {
      throw normalizeWorkspaceError(error, '创建预设失败')
    }
  }

  async function savePreset(input: SavePresetInput) {
    try {
      const document = await ports.preset.savePreset(input)
      upsertPreset(document)
      presetDocumentState.value = document
      return document
    } catch (error) {
      throw normalizeWorkspaceError(error, '保存预设失败')
    }
  }

  async function renamePreset(input: RenamePresetInput) {
    try {
      const document = await ports.preset.renamePreset(input)
      presetCatalogState.value = presetCatalogState.value.filter(({ kind, fileName }) => (
        kind !== input.kind || fileName !== input.fileName
      ))
      upsertPreset(document)
      presetDocumentState.value = document
      return document
    } catch (error) {
      throw normalizeWorkspaceError(error, '重命名预设失败')
    }
  }

  async function deletePreset(input: DeletePresetInput) {
    try {
      const result = await ports.preset.deletePreset(input)
      presetCatalogState.value = presetCatalogState.value.filter(({ kind, fileName }) => (
        kind !== input.kind || fileName !== input.fileName
      ))
      if (presetDocumentState.value?.kind === input.kind && presetDocumentState.value.fileName === input.fileName) {
        presetDocumentState.value = undefined
      }
      return result
    } catch (error) {
      throw normalizeWorkspaceError(error, '删除预设失败')
    }
  }

  async function locatePresetExpression(input: LocateStudioPresetExpressionInput): Promise<LocateStudioPresetExpressionResult> {
    try {
      return await ports.preset.locatePresetExpression(input)
    } catch (error) {
      throw normalizeWorkspaceError(error, '定位预设表达式失败')
    }
  }

  function upsertPreset(document: StudioPresetDocument) {
    presetCatalogState.value = [
      ...presetCatalogState.value.filter(({ kind, fileName }) => (
        kind !== document.kind || fileName !== document.fileName
      )),
      document,
    ].sort((left, right) => left.kind.localeCompare(right.kind) || left.fileName.localeCompare(right.fileName))
  }

  return {
    appearance: readonly(appearanceState),
    persistence: readonly(persistenceState),
    modelRequestRecords: readonly(modelRequestRecordsState) as DeepReadonly<typeof modelRequestRecordsState>,
    modelRequestRecord: readonly(modelRequestRecordState) as DeepReadonly<typeof modelRequestRecordState>,
    modelRequestTrajectory: readonly(modelRequestTrajectoryState) as DeepReadonly<typeof modelRequestTrajectoryState>,
    modelRequestFacets: readonly(modelRequestFacetsState) as DeepReadonly<typeof modelRequestFacetsState>,
    modelRequestRecordsPage: readonly(modelRequestRecordsPageState),
    presetCatalog: readonly(presetCatalogState) as DeepReadonly<typeof presetCatalogState>,
    presetDocument: readonly(presetDocumentState) as DeepReadonly<typeof presetDocumentState>,
    loadWorkspace,
    loadModelRequestRecords,
    loadModelRequestRecord,
    loadModelRequestTrajectory,
    loadModelRequestFacets,
    clearModelRequestRecords,
    loadPresetCatalog,
    readPreset,
    createPreset,
    savePreset,
    renamePreset,
    deletePreset,
    locatePresetExpression,
  }
}

export type StudioWorkspaceController = ReturnType<typeof createWorkspaceController>
