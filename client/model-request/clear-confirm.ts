import { ref } from 'vue'

/**
 * 清理未归属记录的二次确认。
 *
 * 清理不可恢复，因此对话框分两步：第一步说清后果，第二步才给出执行按钮。
 * 两条不变量必须同时成立，缺一个二次确认就形同虚设：每次打开都从第一步开始
 * （否则上一轮按 Esc 关掉后重新打开会直接停在「确认清理」），以及执行只在第二步
 * 生效（否则第一步的按钮换个绑定就能直接清空）。
 */
export type ModelRequestClearStep = 1 | 2

export interface ModelRequestClearConfirmOptions {
  clear: () => void
}

export function createModelRequestClearConfirm(options: ModelRequestClearConfirmOptions) {
  const open = ref(false)
  const step = ref<ModelRequestClearStep>(1)

  function begin() {
    step.value = 1
    open.value = true
  }

  function advance() {
    step.value = 2
  }

  function cancel() {
    open.value = false
    step.value = 1
  }

  function confirm() {
    if (step.value !== 2) return
    options.clear()
    cancel()
  }

  return { open, step, begin, advance, cancel, confirm }
}
