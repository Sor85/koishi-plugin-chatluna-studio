import type { StudioWorkspaceView } from '#client/workspace/state'

export type PresetDirtyAction = 'create' | 'rename' | 'delete' | 'leave'

export interface PresetDirtyGuardRequest {
  action: PresetDirtyAction
  targetView?: StudioWorkspaceView
}

export interface PresetDirtyGuardState {
  dirty: boolean
  pending?: PresetDirtyGuardRequest
}

export function createPresetDirtyGuard() {
  let dirty = false
  let pending: PresetDirtyGuardRequest | undefined

  function update(nextDirty: boolean) {
    dirty = nextDirty
    if (!dirty) pending = undefined
  }

  function request(requested: PresetDirtyGuardRequest) {
    if (!dirty) return true
    pending = { ...requested }
    return false
  }

  function peek(): PresetDirtyGuardState {
    return {
      dirty,
      ...(pending ? { pending: { ...pending } } : {}),
    }
  }

  function cancel() {
    pending = undefined
  }

  function discard() {
    const requested = pending
    dirty = false
    pending = undefined
    return requested
  }

  return { update, request, peek, cancel, discard }
}
