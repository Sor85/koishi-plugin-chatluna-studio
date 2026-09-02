import type { StudioAppearance, StudioPersistenceStatus } from '../../src/types'
import type { StudioWorkspaceState } from '../../src/console-contract'
import { FakePortRecorder } from '#client/shared/fake-port-recorder'
import type { ModelRequestRecordedListener, WorkspacePort, WorkspacePortOperation } from './port'

export const defaultFakeAppearance: StudioAppearance = {
  enableStudioFrostedGlass: true,
  studioColorMode: 'auto',
  studioAccentColor: '#2563eb',
  studioUseQQAvatars: true,
}

export const defaultFakePersistence: StudioPersistenceStatus = {
  mode: 'memory',
  available: true,
  persisted: false,
}

/** 内存工作区端口。广播可以由测试直接触发，不必伪造 Koishi 的事件总线。 */
export class FakeWorkspacePort implements WorkspacePort {
  workspaceResult: StudioWorkspaceState = {
    appearance: { ...defaultFakeAppearance },
    persistence: { ...defaultFakePersistence },
  }

  private readonly recorder = new FakePortRecorder<WorkspacePortOperation>()
  private readonly listeners = new Set<ModelRequestRecordedListener>()

  get calls() {
    return this.recorder.calls
  }

  rejectNext(operation: WorkspacePortOperation, error: unknown) {
    this.recorder.rejectNext(operation, error)
  }

  getWorkspace() {
    return this.recorder.invoke('getWorkspace', undefined, this.workspaceResult)
  }

  subscribeModelRequestRecorded(listener: ModelRequestRecordedListener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 测试驱动：模拟服务端广播了一条新记录。 */
  emitModelRequestRecorded(sequence: number) {
    for (const listener of this.listeners) listener({ sequence })
  }

  get subscriberCount() {
    return this.listeners.size
  }
}

export function createFakeWorkspacePort() {
  return new FakeWorkspacePort()
}
