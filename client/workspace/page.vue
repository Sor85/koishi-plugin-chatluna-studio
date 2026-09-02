<template>
  <k-layout container="chatluna-studio-layout" main="chatluna-studio-page">
    <k-content>
      <div
        class="chatluna-studio-workspace"
        :class="{ 'is-frosted': appearance.enableStudioFrostedGlass }"
        :data-color-mode="resolvedColorMode"
        :style="{ '--chatluna-studio-accent': appearance.studioAccentColor }"
      >
        <header class="chatluna-studio-topbar">
          <span class="chatluna-studio-topbar-title">
            <IconSparkles :size="18" aria-hidden="true" />
            ChatLuna 工作室
          </span>
          <nav class="chatluna-studio-topbar-views" aria-label="工作室页面">
            <Button
              size="sm"
              :variant="currentView === 'model-requests' ? 'secondary' : 'ghost'"
              :aria-current="currentView === 'model-requests' ? 'page' : undefined"
              @click="shell.selectView('model-requests')"
            >
              <IconRoute data-icon="inline-start" aria-hidden="true" />
              模型请求
            </Button>
            <Button
              size="sm"
              :variant="currentView === 'presets' ? 'secondary' : 'ghost'"
              :aria-current="currentView === 'presets' ? 'page' : undefined"
              @click="shell.selectView('presets')"
            >
              <IconFileCode data-icon="inline-start" aria-hidden="true" />
              预设
            </Button>
          </nav>
          <span class="chatluna-studio-topbar-status" role="status">
            <IconDatabase :size="14" aria-hidden="true" />
            {{ persistenceLabel }}
          </span>
        </header>

        <ModelRequestWorkspace
          v-if="currentView === 'model-requests'"
          :records="model.records"
          :detail="model.detail"
          :trajectory="model.trajectory"
          :facets="model.facets"
          :use-q-q-avatars="model.useQQAvatars"
          :has-more="model.hasMore"
          :next-cursor="model.nextCursor"
          :loading="model.loading"
          :detail-loading="model.detailLoading"
          :error="model.error"
          :visit-key="shell.modelRequestVisitKey.value"
          :navigation="shell.evidenceNavigation"
          @query="(input) => shell.loadModelRequestRecords(input)"
          @load-more="(input) => shell.loadMoreModelRequestRecords(input)"
          @open="(input) => { void shell.loadModelRequestRecord(input).catch(() => {}) }"
          @trajectory="(input) => shell.loadModelRequestTrajectory(input)"
          @clear="() => shell.clearModelRequestRecords()"
          @navigation-failure="shell.reportEvidenceNavigationFailure"
          @return-to-preset="shell.returnToPresetOrigin"
        />

        <PresetWorkspace
          v-else
          :catalog="preset.catalog"
          :document="preset.document"
          :loading="preset.loading"
          :saving="preset.saving"
          :error="preset.error"
          :discard-guard-open="Boolean(shell.presetDiscardGuard.value.pending)"
          :discard-guard-action="shell.presetDiscardGuard.value.pending?.action"
          :origin-restore="shell.evidenceNavigation.presetOriginRestore.value"
          @refresh="shell.loadPresetCatalog"
          @read="(input) => { void shell.readPreset(input).catch(() => {}) }"
          @create="runPresetMutation(shell.createPreset)"
          @save="runPresetMutation(shell.savePreset)"
          @rename="runPresetMutation(shell.renamePreset)"
          @delete="runPresetMutation(shell.deletePreset)"
          @locate="settleLocate"
          @navigate-evidence="shell.navigateToPresetEvidence"
          @read-request="settleReadRequest"
          @dirty-change="shell.updatePresetDirty"
          @cancel-discard="shell.cancelPresetDiscard"
          @confirm-discard="shell.confirmPresetDiscard"
        />
      </div>
    </k-content>
  </k-layout>
</template>

<script setup lang="ts">
import { IconDatabase, IconFileCode, IconRoute, IconSparkles } from '@tabler/icons-vue'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { Button } from '#client/components/ui/button'
import ModelRequestWorkspace from '#client/model-request/workspace.vue'
import PresetWorkspace from '#client/preset/workspace.vue'
import { createKoishiModelRequestPort } from '#client/model-request/koishi-port'
import { createKoishiPresetPort } from '#client/preset/koishi-port'
import { createKoishiWorkspacePort } from './koishi-port'
import { useFrostedSurfaceFlag, useResolvedColorMode } from './color-scheme'
import { createStudioWorkspaceShell } from './shell'
import type {
  LocateStudioPresetExpressionInput,
  LocateStudioPresetExpressionResult,
} from '../../src/presets'
import type { StudioModelRequestDetail } from '../../src/types'

const shell = createStudioWorkspaceShell({
  ports: {
    workspace: createKoishiWorkspacePort(),
    modelRequest: createKoishiModelRequestPort(),
    preset: createKoishiPresetPort(),
  },
})

const appearance = shell.appearance
const currentView = shell.currentView
const model = shell.modelRequestWorkspaceModel
const preset = shell.presetWorkspaceModel
const resolvedColorMode = useResolvedColorMode(appearance)
useFrostedSurfaceFlag(appearance)

const persistenceLabel = computed(() => {
  const persistence = shell.persistence.value
  if (persistence.mode === 'memory') return '记录存内存，重启后清空'
  return persistence.available ? '记录已落库' : persistence.message || '数据库不可用，记录不落盘'
})

/**
 * 预设工作台的写操作用 resolve/reject 回执驱动自己的对话框与脏值状态。
 *
 * 页面这一层只把失败原样交回去：错误文案已经由区域错误位写进 `preset.error`，再在这里额外
 * 兜一次会让同一次失败被展示两遍。
 */
function runPresetMutation<Input>(mutate: (input: Input) => Promise<unknown>) {
  return (input: Input, resolve: () => void, reject: (error: unknown) => void) => {
    void mutate(input).then(() => resolve(), reject)
  }
}

function settleLocate(
  input: LocateStudioPresetExpressionInput,
  resolve: (result: LocateStudioPresetExpressionResult) => void,
  reject: (error: unknown) => void,
) {
  void shell.locatePresetExpression(input).then(resolve, reject)
}

function settleReadRequest(
  input: { recordId: string },
  resolve: (detail: StudioModelRequestDetail) => void,
  reject: (error: unknown) => void,
) {
  void shell.loadModelRequestRecord(input).then(resolve, reject)
}

onMounted(() => {
  void shell.initialize()
})

onBeforeUnmount(() => {
  shell.dispose()
})
</script>
