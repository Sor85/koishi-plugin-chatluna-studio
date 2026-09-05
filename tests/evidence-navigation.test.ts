import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createEvidenceNavigation,
  type EvidenceViewSnapshot,
} from '../client/shared/evidence-navigation'
import type { StudioModelRequestTrajectory } from '../src/types'

function trajectory(
  mode: 'request' | 'conversation',
  recordIds: readonly string[],
): Pick<StudioModelRequestTrajectory, 'mode' | 'records'> {
  return {
    mode,
    records: recordIds.map((id) => ({ id })) as never,
  }
}

function matched(recordId = 'record-1', evidenceId = 'req:message:messages.0') {
  return {
    status: 'matched' as const,
    recordId,
    evidenceId,
    range: { start: 3, end: 8 },
  }
}

function viewSnapshot(recordId = 'request-1'): EvidenceViewSnapshot {
  return {
    recordId,
    detailView: 'trajectory',
    bodyView: 'analysis',
    trajectoryMode: 'conversation',
    expandedTrajectoryRequestIds: [recordId],
    detailScrollTop: 640,
    trajectory: { rowId: 'req:message:contents.0', scrollTop: 1820 },
  }
}

describe('证据导航', () => {
  describe('进入模型请求视图', () => {

    it('从预设工作台进入时携带证据定位段并给出正在定位的进行态文案', () => {
      const navigation = createEvidenceNavigation()

      expect(navigation.enterFromPreset(matched())).toEqual({
        seq: 1,
        recordId: 'record-1',
        evidence: { evidenceId: 'req:message:messages.0', range: { start: 3, end: 8 } },
      })
      // 预设证据只可能来自有归属的请求，因此进入状态把范围收到「已归属」并声明这是一次导航选中。
      expect(navigation.entryState.value).toMatchObject({
        seq: 1,
        recordId: 'record-1',
        category: 'attributed',
        detailView: 'evidence',
        bodyView: 'analysis',
        navigationSelection: true,
        status: '正在打开匹配的模型请求并定位精确文本…',
      })
    })

    it('一次性令牌与进入状态绑定，消费一次后失效', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched())

      // 视图写入筛选并报告筛选真的变了：令牌留到筛选侦听器消费一次，之后不再挡掉用户自己的清空。
      navigation.applyEntry(navigation.entryState.value!.seq, true)
      expect(navigation.preserveSelectionOnFilterChange()).toBe(true)
      expect(navigation.preserveSelectionOnFilterChange()).toBe(false)
    })

    it('进入状态没有改变筛选时令牌立即失效', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched())

      // 筛选没变化时侦听器不会触发，令牌必须当场失效，否则它会留到下一次用户主动改筛选。
      navigation.applyEntry(navigation.entryState.value!.seq, false)
      expect(navigation.preserveSelectionOnFilterChange()).toBe(false)
    })

    it('过期编号不消费进入状态', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched())
      const current = navigation.entryState.value!.seq

      navigation.applyEntry(current - 1, true)
      expect(navigation.entryState.value?.seq).toBe(current)
      navigation.applyEntry(current, true)
      expect(navigation.entryState.value).toBeUndefined()
    })

    it('重新进入时上一次的工作台内快照不冒充回程', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched())
      navigation.pushViewSnapshot(viewSnapshot())
      expect(navigation.returnTarget.value).toBe('view')

      // 视图已经被销毁重建，上一次的快照属于那一次进入，不能在新一次进入里当回程。
      navigation.enterFromPreset(matched('record-2'))
      expect(navigation.returnTarget.value).toBe('presets')
    })

    it('从预设工作台进入时只发布匹配结果', () => {
      const navigation = createEvidenceNavigation()

      expect(navigation.enterFromPreset({
        status: 'failed',
        code: 'request-not-observed',
        message: 'missing',
      })).toBeUndefined()
      expect(navigation.entryState.value).toBeUndefined()
      expect(navigation.returnTarget.value).toBeUndefined()
    })

    // 这是原先漏掉的那一层：接线在视图里，无处断言，于是预设路径漏掉列表选择保护。

    // 筛选值没变时侦听器不会触发；令牌必须当场失效，否则会挡掉下一次用户主动改筛选的清空。

    it('视图应用进入状态后，携带证据定位段的意图继续等待到达', () => {
      const navigation = createEvidenceNavigation()
      const intent = navigation.enterFromPreset(matched())!

      navigation.applyEntry(intent.seq, true)
      expect(navigation.entryState.value).toBeUndefined()
      expect(navigation.pending.value?.recordId).toBe('record-1')
    })

    it('进入编号单调递增，连续多次跳转每次都产生新的进入状态', () => {
      const navigation = createEvidenceNavigation()

      expect(navigation.enterFromPreset(matched('record-1'))?.seq).toBe(1)
      expect(navigation.enterFromPreset(matched('record-1'))?.seq).toBe(2)
      expect(navigation.entryState.value?.seq).toBe(2)
    })
  })

  describe('到达闸门', () => {
    it('三个条件全部满足才交出定位请求，已交出后不重复', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-new', 'req:message:messages.0'))

      expect(navigation.arrive({ id: 'record-new' }, trajectory('request', ['record-old']))).toBeUndefined()
      expect(navigation.arrive({ id: 'record-old' }, trajectory('request', ['record-new']))).toBeUndefined()
      expect(navigation.arrive({ id: 'record-new' }, trajectory('request', ['record-new']))).toEqual({
        evidenceId: 'req:message:messages.0',
        seq: 1,
        range: { start: 3, end: 8 },
      })
      expect(navigation.arrive({ id: 'record-new' }, trajectory('request', ['record-new']))).toBeUndefined()
    })

    it('轨迹处于会话模式时不触发单请求定位', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))

      expect(navigation.arrive({ id: 'record-1' }, trajectory('conversation', ['record-1']))).toBeUndefined()
      expect(navigation.locateRequest.value).toBeUndefined()
    })

    it('详情或轨迹缺失时不触发定位', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))

      expect(navigation.arrive(undefined, trajectory('request', ['record-1']))).toBeUndefined()
      expect(navigation.arrive({ id: 'record-1' }, undefined)).toBeUndefined()
    })

    it('只在闸门交出的那一次定位回执上结束意图', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))
      const request = navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))!

      expect(navigation.acknowledgeLocate(request.seq + 1, true)).toBeUndefined()
      expect(navigation.pending.value?.recordId).toBe('record-1')
      expect(navigation.acknowledgeLocate(request.seq, false)).toMatchObject({
        located: false,
        intent: { recordId: 'record-1' },
      })
      expect(navigation.pending.value).toBeUndefined()
      expect(navigation.locateRequest.value).toBeUndefined()
    })

    it('连续多次跳转每次都真的重新定位', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))
      const first = navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))!
      navigation.acknowledgeLocate(first.seq, true)

      navigation.enterFromPreset(matched('record-1'))
      const second = navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))!

      expect(second.seq).toBeGreaterThan(first.seq)
      expect(navigation.locateRequest.value?.seq).toBe(second.seq)
    })

    it('用户主动点选其他请求时取消待处理的跳转', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))

      navigation.selectOtherRecord()

      expect(navigation.pending.value).toBeUndefined()
      expect(navigation.entryState.value).toBeUndefined()
      expect(navigation.preserveSelectionOnFilterChange()).toBe(false)
      expect(navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))).toBeUndefined()
    })

    it('切换到其他视图后再回来不残留上次的跳转意图', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))
      navigation.pushViewSnapshot(viewSnapshot())

      navigation.clear()

      expect(navigation.pending.value).toBeUndefined()
      expect(navigation.entryState.value).toBeUndefined()
      expect(navigation.locateRequest.value).toBeUndefined()
      expect(navigation.returnTarget.value).toBeUndefined()
      expect(navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))).toBeUndefined()
    })
  })

  describe('详情内定位发号源', () => {
    it('三个来源共用同一个单调编号', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))

      const gated = navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))!
      const fromLedger = navigation.locateEvidence('req:message:messages.1')
      const fromSegment = navigation.locateEvidence('req:tool:tools.0')

      expect([gated.seq, fromLedger.seq, fromSegment.seq]).toEqual([1, 2, 3])
    })

    // 闸门那一次定位由 module 持有，账本与分段的定位由发起它们的视图持有；两者不会互相吞掉。
    it('账本与分段取号不覆盖闸门交出的定位请求', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))
      const gated = navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))!

      navigation.locateEvidence('req:message:messages.1')

      expect(navigation.locateRequest.value).toEqual(gated)
    })

    it('账本与分段的定位不携带文本范围，也不结束待处理意图', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))
      const ledger = navigation.locateEvidence('req:message:messages.1')

      expect(ledger).toEqual({ evidenceId: 'req:message:messages.1', seq: 1 })
      expect(navigation.acknowledgeLocate(ledger.seq, true)).toBeUndefined()
      expect(navigation.pending.value?.recordId).toBe('record-1')
    })

    it('切换详情内视图时丢弃闸门那一次定位请求', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))
      navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))

      navigation.resetLocate()

      expect(navigation.locateRequest.value).toBeUndefined()
    })
  })

  describe('工作台内视图返回栈', () => {
    it('没有离开过时不能返回', () => {
      const navigation = createEvidenceNavigation()

      expect(navigation.returnTarget.value).toBeUndefined()
      expect(navigation.beginViewReturn()).toBeUndefined()
      expect(navigation.takeViewRestore('request-1')).toBeUndefined()
    })

    it('压入快照后可以返回，并在目标详情到达时交出完整快照与恢复编号', () => {
      const navigation = createEvidenceNavigation()
      navigation.pushViewSnapshot(viewSnapshot())

      expect(navigation.returnTarget.value).toBeDefined()
      expect(navigation.returnTarget.value).toBe('view')
      expect(navigation.beginViewReturn()).toMatchObject({
        recordId: 'request-1',
        detailView: 'trajectory',
        bodyView: 'analysis',
        trajectoryMode: 'conversation',
        detailScrollTop: 640,
        trajectory: { rowId: 'req:message:contents.0', scrollTop: 1820 },
      })
      // 开始返回后按钮就该消失：快照已经转为待消费，不能再返回第二次。
      expect(navigation.returnTarget.value).toBeUndefined()
      expect(navigation.takeViewRestore('request-1')).toMatchObject({ recordId: 'request-1', seq: 1 })
      expect(navigation.viewRestore.value?.seq).toBe(1)
    })

    it('跨请求返回时等目标详情按记录身份到达后才恢复', () => {
      const navigation = createEvidenceNavigation()
      navigation.pushViewSnapshot(viewSnapshot())
      navigation.beginViewReturn()

      expect(navigation.takeViewRestore(undefined)).toBeUndefined()
      expect(navigation.takeViewRestore('request-9')).toBeUndefined()
      expect(navigation.takeViewRestore('request-1')).toMatchObject({ recordId: 'request-1' })
    })

    it('待恢复快照只能消费一次', () => {
      const navigation = createEvidenceNavigation()
      navigation.pushViewSnapshot(viewSnapshot())
      navigation.beginViewReturn()

      expect(navigation.takeViewRestore('request-1')).toBeTruthy()
      expect(navigation.takeViewRestore('request-1')).toBeUndefined()
    })

    it('恢复编号单调递增，同一位置也能再次恢复', () => {
      const navigation = createEvidenceNavigation()
      navigation.pushViewSnapshot(viewSnapshot())
      navigation.beginViewReturn()
      expect(navigation.takeViewRestore('request-1')?.seq).toBe(1)

      navigation.pushViewSnapshot(viewSnapshot())
      navigation.beginViewReturn()
      expect(navigation.takeViewRestore('request-1')?.seq).toBe(2)
    })

    it('未开始返回时不消费已压入的快照', () => {
      const navigation = createEvidenceNavigation()
      navigation.pushViewSnapshot(viewSnapshot())

      expect(navigation.takeViewRestore('request-1')).toBeUndefined()
      expect(navigation.returnTarget.value).toBeDefined()
    })

    it('再次压入会覆盖上一份未使用的快照', () => {
      const navigation = createEvidenceNavigation()
      navigation.pushViewSnapshot(viewSnapshot('request-1'))
      navigation.pushViewSnapshot(viewSnapshot('request-2'))

      expect(navigation.beginViewReturn()?.recordId).toBe('request-2')
    })

    it('清空同时丢弃已压入与待消费的快照', () => {
      const navigation = createEvidenceNavigation()
      navigation.pushViewSnapshot(viewSnapshot())
      navigation.beginViewReturn()
      navigation.pushViewSnapshot(viewSnapshot('request-2'))

      navigation.clear()

      expect(navigation.returnTarget.value).toBeUndefined()
      expect(navigation.beginViewReturn()).toBeUndefined()
      expect(navigation.takeViewRestore('request-1')).toBeUndefined()
      expect(navigation.takeViewRestore('request-2')).toBeUndefined()
    })
  })

  describe('预设工作台原点', () => {
    it('跳转时保存原点位置，返回时原样交出并自带恢复编号', () => {
      const navigation = createEvidenceNavigation()
      const editorScroll = { kind: 'scroll-snapshot' }
      navigation.enterFromPreset(matched(), {
        listScrollTop: 420,
        searchQuery: 'system',
        editorScroll,
      })

      expect(navigation.returnToPresetOrigin()).toEqual({
        listScrollTop: 420,
        searchQuery: 'system',
        editorScroll,
        seq: 1,
      })
      expect(navigation.presetOriginRestore.value?.seq).toBe(1)
      expect(navigation.returnToPresetOrigin()).toBeUndefined()
    })

    it('没有携带原点快照时给出空快照', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched())

      expect(navigation.returnToPresetOrigin()).toEqual({
        listScrollTop: 0,
        searchQuery: '',
        seq: 1,
      })
    })

    it('定位意图消费后仍可返回预设，直到显式返回或清空', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))
      const request = navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))!
      navigation.acknowledgeLocate(request.seq, true)

      expect(navigation.pending.value).toBeUndefined()
      expect(navigation.returnTarget.value).toBeDefined()
      expect(navigation.returnTarget.value).toBe('presets')
      expect(navigation.returnToPresetOrigin()?.seq).toBe(1)
      expect(navigation.returnTarget.value).toBeUndefined()
    })

    it('返回预设时丢弃仍在等待的跳转意图', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched('record-1'))

      navigation.returnToPresetOrigin()

      expect(navigation.pending.value).toBeUndefined()
      expect(navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))).toBeUndefined()
    })

    it('恢复编号单调递增，重复跳转同一预设也能再次恢复', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched())
      navigation.returnToPresetOrigin()
      navigation.enterFromPreset(matched())

      expect(navigation.returnToPresetOrigin()?.seq).toBe(2)
    })

    it('用户主动点选其他请求时预设回程保留，工作台内回程让位', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched())
      navigation.pushViewSnapshot(viewSnapshot())
      expect(navigation.returnTarget.value).toBe('view')

      navigation.selectOtherRecord()

      expect(navigation.returnTarget.value).toBe('presets')
    })
  })

  describe('四个编号互不重叠', () => {
    it('同时可从轨迹和预设返回时返回指向最近一次离开的位置', () => {
      const navigation = createEvidenceNavigation()
      navigation.enterFromPreset(matched())
      expect(navigation.returnTarget.value).toBe('presets')

      navigation.pushViewSnapshot(viewSnapshot())
      expect(navigation.returnTarget.value).toBe('view')

      navigation.beginViewReturn()
      navigation.takeViewRestore('request-1')
      expect(navigation.returnTarget.value).toBe('presets')
    })

    it('四个编号各自单调，互不干扰', () => {
      const navigation = createEvidenceNavigation()
      const first = navigation.enterFromPreset(matched('record-1'))!
      const gated = navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))!
      navigation.pushViewSnapshot(viewSnapshot())
      navigation.beginViewReturn()
      const restore = navigation.takeViewRestore('request-1')!
      const origin = navigation.returnToPresetOrigin()!

      expect([first.seq, gated.seq, restore.seq, origin.seq]).toEqual([1, 1, 1, 1])

      const second = navigation.enterFromPreset(matched('record-1'))!
      const secondGated = navigation.arrive({ id: 'record-1' }, trajectory('request', ['record-1']))!
      navigation.pushViewSnapshot(viewSnapshot())
      navigation.beginViewReturn()
      const secondRestore = navigation.takeViewRestore('request-1')!
      const secondOrigin = navigation.returnToPresetOrigin()!

      expect([second.seq, secondGated.seq, secondRestore.seq, secondOrigin.seq]).toEqual([2, 2, 2, 2])
    })

  })

  describe('module 归属', () => {
    it('四个旧 module 与其测试文件已删除，无残留引用', () => {
      const removed = [
        'preset-evidence-navigation',
        'preset-navigation-coordinator',
        'evidence-navigation-stack',
        'model-request-navigation',
      ]
      for (const name of removed) {
        expect(existsSync(resolve('client/studio', `${name}.ts`))).toBe(false)
        expect(existsSync(resolve('tests', `${name}.test.ts`))).toBe(false)
      }

      const sources = [
        'client/workspace/page.vue',
        'client/model-request/workspace.vue',
        'client/model-request/trajectory.vue',
        'client/preset/workspace.vue',
        'client/workspace/shell.ts',
        'client/model-request/list-selection.ts',
      ].map((file) => readFileSync(resolve(file), 'utf8')).join('\n')

      for (const name of removed) expect(sources).not.toContain(name)
    })

    // 客户端不再有位于证据导航 module 之外的往返触发编号。
    it('往返触发编号只在证据导航 module 内递增', () => {
      const navigationSource = readFileSync(resolve('client/shared/evidence-navigation.ts'), 'utf8')
      expect(navigationSource).toContain('++entrySeq')
      expect(navigationSource).toContain('++locateSeq')
      expect(navigationSource).toContain('++viewRestoreSeq')
      expect(navigationSource).toContain('++presetOriginSeq')

      const consumers = [
        'client/workspace/page.vue',
        'client/model-request/workspace.vue',
        'client/model-request/trajectory.vue',
        'client/workspace/shell.ts',
      ]
      for (const file of consumers) {
        const source = readFileSync(resolve(file), 'utf8')
        expect(source).not.toMatch(/(?:Seq|seq)\.value \+= 1|\+\+\w*[Ss]eq/)
      }
    })

    it('模型请求列表选择只保留普通选择与跨页补入', () => {
      const source = readFileSync(resolve('client/model-request/list-selection.ts'), 'utf8')
      expect(source).not.toContain('preserveNextClear')
      expect(source).not.toContain('releaseModelRequestListNavigationGuard')
    })
  })
})
