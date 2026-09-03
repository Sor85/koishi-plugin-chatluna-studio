<template>
  <k-layout container="chatluna-studio-layout" main="chatluna-studio-page">
    <k-content>
      <div
        class="chatluna-studio-workspace"
        :class="{ 'is-frosted': appearance.enableStudioFrostedGlass }"
        :data-color-mode="resolvedColorMode"
        :style="{ '--chatluna-studio-accent': appearance.studioAccentColor }"
      >
        <!-- 悬浮导航栏：折叠态只露图标，鼠标悬停或键盘聚焦时向左展开出文字。
             文字始终留在 DOM 里（折叠时被卡片裁掉），因此读屏软件在两种状态下读到的都是同一份标签。
             `nav` 就是卡片本身：这层只有两个页面入口，再套一层容器只会多一个没有样式的节点。 -->
        <div class="chatluna-studio-sidebar">
          <nav class="chatluna-studio-sidebar-rail" aria-label="工作室页面">
            <button
              type="button"
              class="chatluna-studio-sidebar-item"
              :class="{ 'is-active': currentView === 'model-requests' }"
              :aria-current="currentView === 'model-requests' ? 'page' : undefined"
              @click="shell.selectView('model-requests')"
            >
              <span class="chatluna-studio-sidebar-icon">
                <IconRoute :size="20" aria-hidden="true" />
              </span>
              <span class="chatluna-studio-sidebar-label">模型请求</span>
            </button>
            <button
              type="button"
              class="chatluna-studio-sidebar-item"
              :class="{ 'is-active': currentView === 'presets' }"
              :aria-current="currentView === 'presets' ? 'page' : undefined"
              @click="shell.selectView('presets')"
            >
              <span class="chatluna-studio-sidebar-icon">
                <IconFileCode :size="20" aria-hidden="true" />
              </span>
              <span class="chatluna-studio-sidebar-label">预设</span>
            </button>
          </nav>
        </div>

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
import { IconFileCode, IconRoute } from '@tabler/icons-vue'
import { onBeforeUnmount, onMounted } from 'vue'
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
