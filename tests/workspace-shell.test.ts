import { describe, expect, it } from 'vitest'
import { createStudioWorkspaceShell } from '../client/workspace/shell'
import { createFakeWorkspacePort } from '../client/workspace/fake-port'
import { createFakeModelRequestPort } from '../client/model-request/fake-port'
import { createFakePresetPort } from '../client/preset/fake-port'
import type { StudioPresetDocument } from '../src/presets'
import type { StudioModelRequestListItem } from '../src/types'

/**
 * 工作室 shell：跨区域规则住在这里，页面只做布局与事件绑定。
 *
 * 三个端口都是内存替身，因此这些规则——切视图时清跳转意图、预设脏了先问一句、新记录广播只推
 * 访问计数——可以在没有浏览器的情况下被完整驱动。
 */

function listItem(id: string): StudioModelRequestListItem {
  return {
    id,
    sequence: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    status: 'success',
    durationMs: 10,
    attribution: 'attributed',
    entities: { platform: 'onebot', botId: '10001', conversationId: '20002', conversationType: 'group' },
    requestBodyAvailable: true,
    responseBodyStatus: 'complete',
  }
}

function presetDocument(fileName: string): StudioPresetDocument {
  return {
    kind: 'core',
    fileName,
    displayName: fileName.replace('.yml', ''),
    source: 'keywords:\n  - demo\n',
    revision: 'rev-1',
    size: 24,
    modifiedAt: '2026-09-01T00:00:00.000Z',
    templateFields: [],
    expressions: [],
    diagnostics: [],
  }
}

function createShell() {
  const workspace = createFakeWorkspacePort()
  const modelRequest = createFakeModelRequestPort()
  const preset = createFakePresetPort()
  const shell = createStudioWorkspaceShell({ ports: { workspace, modelRequest, preset } })
  return { shell, workspace, modelRequest, preset }
}

describe('工作室 shell', () => {
  it('初始化读一次工作区状态，外观交给页面渲染', async () => {
    const { shell, workspace } = createShell()
    workspace.workspaceResult = {
      appearance: {
        enableStudioFrostedGlass: false,
        studioColorMode: 'dark',
        studioAccentColor: '#ff0000',
        studioUseQQAvatars: false,
      },
      persistence: { mode: 'database', available: true, persisted: true },
    }

    await shell.initialize()

    expect(shell.appearance.value.studioColorMode).toBe('dark')
    expect(shell.persistence.value.mode).toBe('database')
    // 外观里的头像开关直接进模型请求页面的入参，页面不再各自读一次配置。
    expect(shell.modelRequestWorkspaceModel.value.useQQAvatars).toBe(false)
  })

  it('列表读取同时刷新筛选可选值，追加分页不重复刷新', async () => {
    const { shell, modelRequest } = createShell()
    modelRequest.modelRequestRecordsResult = {
      records: [listItem('record-1')],
      hasMore: true,
      nextCursor: 1,
      capacity: { recordCount: 1, totalBytes: 10, maxRecords: 500, maxBytes: 1000 },
    }

    await shell.loadModelRequestRecords({ scope: 'all' })
    await shell.loadMoreModelRequestRecords({ scope: 'all', beforeSequence: 1 })

    expect(shell.modelRequestWorkspaceModel.value.records).toHaveLength(2)
    expect(modelRequest.calls.filter(({ operation }) => operation === 'getModelRequestFacets')).toHaveLength(1)
  })

  it('读取失败写进区域错误位，不把异常抛给页面', async () => {
    const { shell, modelRequest } = createShell()
    modelRequest.rejectNext('getModelRequestRecords', new Error('数据库不可用'))

    await shell.loadModelRequestRecords({ scope: 'all' })

    expect(shell.modelRequestWorkspaceModel.value.error).toBe('数据库不可用')
    expect(shell.modelRequestWorkspaceModel.value.loading).toBe(false)
  })

  it('清理记录后列表、详情与轨迹一起归零', async () => {
    const { shell, modelRequest } = createShell()
    modelRequest.modelRequestRecordsResult = {
      records: [listItem('record-1')],
      hasMore: false,
      capacity: { recordCount: 1, totalBytes: 10, maxRecords: 500, maxBytes: 1000 },
    }
    await shell.loadModelRequestRecords({ scope: 'all' })
    expect(shell.modelRequestWorkspaceModel.value.records).toHaveLength(1)

    await shell.clearModelRequestRecords()

    expect(shell.modelRequestWorkspaceModel.value.records).toEqual([])
    expect(shell.modelRequestWorkspaceModel.value.detail).toBeUndefined()
    expect(shell.modelRequestWorkspaceModel.value.trajectory).toBeUndefined()
  })

  it('切到预设视图时读一次目录，切走时清掉跳转意图', async () => {
    const { shell, preset } = createShell()
    preset.presetCatalogResult = [presetDocument('a.yml')]

    expect(shell.selectView('presets')).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(shell.presetWorkspaceModel.value.catalog).toHaveLength(1)

    shell.navigateToPresetEvidence({
      status: 'matched',
      recordId: 'record-1',
      evidenceId: 'req:message:messages.0',
      range: { start: 0, end: 3 },
    })
    expect(shell.currentView.value).toBe('model-requests')
    expect(shell.evidenceNavigation.entryState.value?.recordId).toBe('record-1')

    shell.selectView('presets')
    expect(shell.evidenceNavigation.entryState.value).toBeUndefined()
  })

  it('预设有未保存修改时先问一句，确认丢弃后才真的切走', () => {
    const { shell } = createShell()
    shell.selectView('presets')
    shell.updatePresetDirty(true)

    expect(shell.selectView('model-requests')).toBe(false)
    expect(shell.currentView.value).toBe('presets')
    expect(shell.presetDiscardGuard.value.pending).toEqual({ action: 'leave', targetView: 'model-requests' })

    shell.cancelPresetDiscard()
    expect(shell.presetDiscardGuard.value.pending).toBeUndefined()

    expect(shell.selectView('model-requests')).toBe(false)
    shell.confirmPresetDiscard()
    expect(shell.currentView.value).toBe('model-requests')
  })

  it('保存成功后脏值标记复位，不再拦下一次离开', async () => {
    const { shell, preset } = createShell()
    preset.presetDocumentResult = presetDocument('a.yml')
    shell.selectView('presets')
    shell.updatePresetDirty(true)

    await shell.savePreset({ kind: 'core', fileName: 'a.yml', source: 'keywords:\n  - demo\n', expectedRevision: 'rev-1' })

    expect(shell.presetDiscardGuard.value.dirty).toBe(false)
    expect(shell.selectView('model-requests')).toBe(true)
  })

  it('新记录广播只在模型请求视图上推进访问计数，卸载后不再收', () => {
    const { shell, workspace } = createShell()
    const before = shell.modelRequestVisitKey.value

    workspace.emitModelRequestRecorded(1)
    expect(shell.modelRequestVisitKey.value).toBe(before + 1)

    shell.selectView('presets')
    const afterSwitch = shell.modelRequestVisitKey.value
    workspace.emitModelRequestRecorded(2)
    expect(shell.modelRequestVisitKey.value).toBe(afterSwitch)

    shell.selectView('model-requests')
    shell.dispose()
    const afterDispose = shell.modelRequestVisitKey.value
    workspace.emitModelRequestRecorded(3)
    expect(shell.modelRequestVisitKey.value).toBe(afterDispose)
    expect(workspace.subscriberCount).toBe(0)
  })

  it('返回预设原点落回预设视图', () => {
    const { shell } = createShell()
    shell.navigateToPresetEvidence({
      status: 'matched',
      recordId: 'record-1',
      evidenceId: 'req:message:messages.0',
      range: { start: 0, end: 3 },
    }, { listScrollTop: 120, searchQuery: 'demo' })
    expect(shell.currentView.value).toBe('model-requests')

    shell.returnToPresetOrigin()

    expect(shell.currentView.value).toBe('presets')
    expect(shell.evidenceNavigation.presetOriginRestore.value).toMatchObject({ listScrollTop: 120, searchQuery: 'demo' })
  })

  it('证据导航失败的文案报到模型请求区域的错误位上', () => {
    const { shell } = createShell()
    shell.reportEvidenceNavigationFailure('已打开匹配的模型请求，但无法定位精确文本标记。')
    expect(shell.modelRequestWorkspaceModel.value.error).toBe('已打开匹配的模型请求，但无法定位精确文本标记。')
  })
})
