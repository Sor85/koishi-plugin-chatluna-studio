<template>
  <main class="chatluna-studio-chat chatluna-studio-preset-workspace" aria-label="预设工作台">
    <header class="chatluna-studio-preset-header">
      <div>
        <h1>预设</h1>
        <p>管理和编辑 ChatLuna YAML 预设文件</p>
      </div>
      <div class="chatluna-studio-preset-header-actions">
        <Button variant="outline" :disabled="loading || saving" @click="emit('refresh')">
          <IconRefresh data-icon="inline-start" aria-hidden="true" />
          刷新
        </Button>
        <Button :disabled="saving" @click="openCreateDialog">
          <IconPlus data-icon="inline-start" aria-hidden="true" />
          新建预设
        </Button>
      </div>
    </header>

    <p v-if="error" class="chatluna-studio-preset-error" role="alert">{{ error }}</p>

    <div class="chatluna-studio-preset-layout">
      <aside class="chatluna-studio-preset-list-pane" aria-label="预设文件列表">
        <label class="chatluna-studio-preset-search chatluna-studio-overlay-header">
          <IconSearch aria-hidden="true" />
          <Input v-model="searchQuery" type="search" placeholder="搜索文件名或展示名称" />
        </label>
        <div v-if="loading && !catalog.length" class="chatluna-studio-preset-empty">正在读取预设目录…</div>
        <div v-else ref="listElement" v-chatluna-studio-scrollbar class="chatluna-studio-preset-groups">
          <section v-for="group in presetGroups" :key="group.kind" class="chatluna-studio-preset-group">
            <header>
              <strong>{{ kindLabel(group.kind) }}</strong>
              <Badge variant="secondary">{{ group.documents.length }}</Badge>
            </header>
            <button
              v-for="item in group.documents"
              :key="`${item.kind}:${item.fileName}`"
              type="button"
              class="chatluna-studio-preset-list-item"
              :class="{ 'is-active': item.kind === selectedKind && item.fileName === selectedFileName }"
              @click="requestDocumentSwitch(item)"
            >
              <IconFileCode aria-hidden="true" />
              <span>
                <strong>{{ item.displayName || item.fileName }}</strong>
                <small>{{ item.fileName }}</small>
              </span>
              <time>{{ formatModifiedAt(item.modifiedAt) }}</time>
            </button>
            <p v-if="!group.documents.length" class="chatluna-studio-preset-empty">没有匹配的{{ kindLabel(group.kind) }}预设</p>
          </section>
        </div>
      </aside>

      <section class="chatluna-studio-preset-editor-pane" aria-label="预设源码">
        <div v-if="!document" class="chatluna-studio-preset-empty is-editor">选择一个预设，或新建 YAML 文件</div>
        <template v-else>
          <div ref="editorOverlayElement" class="chatluna-studio-preset-editor-overlay chatluna-studio-overlay-header">
            <header class="chatluna-studio-preset-document-header">
              <div>
                <span class="chatluna-studio-preset-document-title">
                  <IconFileCode aria-hidden="true" />
                  <strong>{{ document.displayName || document.fileName }}</strong>
                  <Badge variant="outline">{{ kindLabel(document.kind) }}</Badge>
                </span>
              </div>
              <div class="chatluna-studio-preset-document-actions">
                <span v-if="showSaveStatus" class="chatluna-studio-preset-save-status" :data-status="saveStatus">
                  {{ saveStatusLabel }}
                </span>
                <Button variant="outline" size="sm" :disabled="saving" @click="openRenameDialog">
                  <IconPencil data-icon="inline-start" aria-hidden="true" />
                  重命名
                </Button>
                <Button variant="destructive" size="sm" :disabled="saving" @click="requestDirtyAction('delete')">
                  <IconTrash data-icon="inline-start" aria-hidden="true" />
                  删除
                </Button>
                <Button size="sm" :disabled="saving || !dirty" @click="saveDocument">
                  <IconDeviceFloppy data-icon="inline-start" aria-hidden="true" />
                  保存
                </Button>
              </div>
            </header>

            <div v-if="document.diagnostics.length" class="chatluna-studio-preset-diagnostics" role="alert">
              <strong>源码诊断</strong>
              <p v-for="diagnostic in document.diagnostics" :key="`${diagnostic.code}:${diagnostic.range?.start ?? 0}`">
                {{ diagnostic.message }}
              </p>
            </div>
          </div>

          <PresetSourceEditor
            ref="editor"
            v-model="source"
            :kind="document.kind"
            :expressions="document.expressions"
            :loaded-source="document.source"
            :read-only="saving"
            :resolve-expression-value="resolveExpressionValue"
            :scroll-to="originEditorScroll"
            @expression-click="locateExpression"
          />

          <footer class="chatluna-studio-preset-editor-footer">
            <p v-if="locateMessage" :class="{ 'is-error': locateFailed }" role="status">{{ locateMessage }}</p>
          </footer>
        </template>
      </section>
    </div>

    <Dialog v-model:open="createDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建预设</DialogTitle>
          <DialogDescription>创建一个新的 .yml 文件。源码会按原样保存，不在浏览器中解析 YAML。</DialogDescription>
        </DialogHeader>
        <div class="chatluna-studio-preset-dialog-fields">
          <label>类型
            <Select v-model="createKind">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>
                <SelectItem value="core">ChatLuna 预设</SelectItem>
                <SelectItem value="character">Character 预设</SelectItem>
              </SelectGroup></SelectContent>
            </Select>
          </label>
          <label>文件名<Input v-model="createFileName" placeholder="example.yml" /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="createDialogOpen = false">取消</Button>
          <Button :disabled="saving || !normalizedCreateFileName" @click="createDocument">创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="renameDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重命名预设</DialogTitle>
          <DialogDescription>重命名不会自动修改上游引用。确认后保存为同类型目录中的新文件名。</DialogDescription>
        </DialogHeader>
        <label class="chatluna-studio-preset-dialog-fields">新文件名<Input v-model="renameFileName" /></label>
        <DialogFooter>
          <Button variant="outline" @click="renameDialogOpen = false">取消</Button>
          <Button :disabled="saving || !normalizedRenameFileName" @click="renameDocument">确认重命名</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="deleteDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除预设</DialogTitle>
          <DialogDescription>删除 {{ document?.fileName }} 不可恢复，并且不会自动更新任何上游引用。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="deleteDialogOpen = false">取消</Button>
          <Button variant="destructive" :disabled="saving" @click="deleteDocument">确认删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="discardGuardOpen" @update:open="handleDiscardGuardOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>放弃未保存修改？</DialogTitle>
          <DialogDescription>{{ discardGuardDescription }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="cancelPendingDiscard">继续编辑</Button>
          <Button variant="destructive" @click="confirmPendingDiscard">{{ discardGuardConfirmLabel }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="conflictDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>预设已被其他位置修改</DialogTitle>
          <DialogDescription>保存使用的 revision 已过期。请重新载入磁盘版本；当前本地源码会保留到你确认刷新为止。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="conflictDialogOpen = false">保留本地修改</Button>
          <Button @click="reloadConflict">重新载入磁盘版本</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </main>
</template>

<script setup lang="ts">
import {
  IconDeviceFloppy,
  IconFileCode,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '@tabler/icons-vue'
import { computed, markRaw, nextTick, onBeforeUnmount, ref, shallowRef, watch, type DeepReadonly } from 'vue'
import type { StateEffect } from '@codemirror/state'
import { Badge } from '#client/components/ui/badge'
import { Button } from '#client/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '#client/components/ui/dialog'
import { Input } from '#client/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '#client/components/ui/select'
import PresetSourceEditor from './source-editor.vue'
import { resolvePresetExpressionObservedValue, type PresetExpressionObservedValueResult } from './expression-value'
import {
  type PresetOriginRestore,
  type PresetOriginSnapshot,
} from '#client/shared/evidence-navigation'
import { createScrollRestore } from '#client/shared/scroll-restore'
import { vStudioScrollbar } from '#client/shared/scrollbar'
import type {
  LocateStudioPresetExpressionInput,
  LocateStudioPresetExpressionResult,
  PresetDocumentKind,
  StudioPresetDocument,
  StudioPresetExpression,
} from '../../src/presets'
import type { StudioModelRequestDetail } from '../../src/types'

const props = defineProps<{
  catalog: readonly DeepReadonly<StudioPresetDocument>[]
  document?: DeepReadonly<StudioPresetDocument>
  loading: boolean
  saving: boolean
  error: string
  discardGuardOpen?: boolean
  discardGuardAction?: 'create' | 'rename' | 'delete' | 'leave'
  originRestore?: PresetOriginRestore
}>()
const emit = defineEmits<{
  refresh: []
  read: [input: { kind: PresetDocumentKind, fileName: string }]
  create: [input: { kind: PresetDocumentKind, fileName: string, source: string }, resolve: () => void, reject: (error: unknown) => void]
  save: [input: { kind: PresetDocumentKind, fileName: string, source: string, expectedRevision: string }, resolve: () => void, reject: (error: unknown) => void]
  rename: [input: { kind: PresetDocumentKind, fileName: string, newFileName: string, expectedRevision: string, confirmed: true }, resolve: () => void, reject: (error: unknown) => void]
  delete: [input: { kind: PresetDocumentKind, fileName: string, expectedRevision: string, confirmed: true }, resolve: () => void, reject: (error: unknown) => void]
  locate: [input: LocateStudioPresetExpressionInput, resolve: (result: LocateStudioPresetExpressionResult) => void, reject: (error: unknown) => void]
  navigateEvidence: [result: LocateStudioPresetExpressionResult & { status: 'matched' }, snapshot: PresetOriginSnapshot]
  readRequest: [input: { recordId: string }, resolve: (detail: StudioModelRequestDetail) => void, reject: (error: unknown) => void]
  dirtyChange: [dirty: boolean]
  cancelDiscard: []
  confirmDiscard: []
}>()

const source = ref('')
const searchQuery = ref('')
const listElement = ref<HTMLElement>()
const editorOverlayElement = ref<HTMLElement>()
let editorOverlayResizeObserver: ResizeObserver | undefined
const editor = ref<{ captureScrollSnapshot: () => StateEffect<unknown> | undefined }>()
const originEditorScroll = shallowRef<StateEffect<unknown>>()
const listScrollRestore = createScrollRestore({
  measure: () => {
    const element = listElement.value
    if (!element) return undefined
    return { scrollTop: element.scrollTop, maxScrollTop: element.scrollHeight - element.clientHeight }
  },
  scrollTo: (top) => {
    if (listElement.value) listElement.value.scrollTop = top
  },
  nextTick,
  frame: () => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  }),
})

const createDialogOpen = ref(false)
const renameDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const localDiscardGuardOpen = ref(false)
const conflictDialogOpen = ref(false)
const createKind = ref<PresetDocumentKind>('core')
const createFileName = ref('')
const renameFileName = ref('')
const pendingDocument = ref<DeepReadonly<StudioPresetDocument>>()
const pendingDirtyAction = ref<'create' | 'rename' | 'delete'>()
const locateMessage = ref('')
const locateFailed = ref(false)
const saveStatus = ref<'saved' | 'dirty' | 'saving' | 'error'>('saved')

const document = computed(() => props.document)
const catalog = computed(() => props.catalog)
const loading = computed(() => props.loading)
const saving = computed(() => props.saving)
const error = computed(() => props.error)
const dirty = computed(() => Boolean(document.value && source.value !== document.value.source))
const selectedKind = computed(() => document.value?.kind)
const selectedFileName = computed(() => document.value?.fileName)
const normalizedCreateFileName = computed(() => normalizeFileName(createFileName.value))
const normalizedRenameFileName = computed(() => normalizeFileName(renameFileName.value))
const discardGuardOpen = computed(() => localDiscardGuardOpen.value || Boolean(props.discardGuardOpen))
const activeDiscardAction = computed(() => pendingDocument.value
  ? 'switch'
  : pendingDirtyAction.value ?? props.discardGuardAction)
const discardGuardDescription = computed(() => {
  if (activeDiscardAction.value === 'switch') return '当前预设源码已修改。切换文件会丢失这些本地修改。'
  if (activeDiscardAction.value === 'create') return '当前预设源码已修改。新建预设会丢失这些本地修改。'
  if (activeDiscardAction.value === 'rename') return '当前预设源码已修改。重命名会丢失这些本地修改。'
  if (activeDiscardAction.value === 'delete') return '当前预设源码已修改。删除会丢失这些本地修改。'
  return '当前预设源码已修改。离开预设页面会丢失这些本地修改。'
})
const discardGuardConfirmLabel = computed(() => {
  if (activeDiscardAction.value === 'switch') return '放弃并切换'
  if (activeDiscardAction.value === 'create') return '放弃并新建'
  if (activeDiscardAction.value === 'rename') return '放弃并重命名'
  if (activeDiscardAction.value === 'delete') return '放弃并删除'
  return '放弃并离开'
})
const showSaveStatus = computed(() => saving.value || dirty.value || saveStatus.value === 'saving' || saveStatus.value === 'error')
const saveStatusLabel = computed(() => {
  if (saving.value || saveStatus.value === 'saving') return '保存中…'
  if (saveStatus.value === 'error') return '保存失败'
  return '有未保存修改'
})
const presetGroups = computed(() => (['core', 'character'] as const).map((kind) => ({
  kind,
  documents: catalog.value.filter((item) => item.kind === kind && matchesSearch(item)),
})))

watch(() => props.document, (next) => {
  if (!next) {
    source.value = ''
    return
  }
  source.value = next.source
  saveStatus.value = 'saved'
  locateMessage.value = ''
}, { immediate: true })
watch(dirty, (value) => {
  emit('dirtyChange', value)
  if (value && saveStatus.value !== 'error') saveStatus.value = 'dirty'
  if (!value && saveStatus.value !== 'error') saveStatus.value = 'saved'
}, { immediate: true })
watch(() => props.originRestore?.seq, async () => {
  const restore = props.originRestore
  if (!restore) return
  searchQuery.value = restore.searchQuery
  originEditorScroll.value = restore.editorScroll
    ? markRaw(restore.editorScroll as StateEffect<unknown>)
    : undefined
  void listScrollRestore.restore(restore.listScrollTop)
  await nextTick()
  originEditorScroll.value = undefined
}, { immediate: true })

watch(editorOverlayElement, (overlay) => {
  editorOverlayResizeObserver?.disconnect()
  editorOverlayResizeObserver = undefined
  if (!overlay) return
  const pane = overlay.closest<HTMLElement>('.chatluna-studio-preset-editor-pane')
  if (!pane) return
  const updateOverlayHeight = () => pane.style.setProperty('--chatluna-studio-preset-overlay-height', `${overlay.offsetHeight}px`)
  updateOverlayHeight()
  if (typeof ResizeObserver === 'undefined') return
  editorOverlayResizeObserver = new ResizeObserver(updateOverlayHeight)
  editorOverlayResizeObserver.observe(overlay)
}, { flush: 'post' })

onBeforeUnmount(() => editorOverlayResizeObserver?.disconnect())

function matchesSearch(item: DeepReadonly<StudioPresetDocument>) {
  const query = searchQuery.value.trim().toLocaleLowerCase('zh-CN')
  return !query || item.fileName.toLocaleLowerCase('zh-CN').includes(query)
    || item.displayName?.toLocaleLowerCase('zh-CN').includes(query)
}

function requestDocumentSwitch(item: DeepReadonly<StudioPresetDocument>) {
  if (item.kind === selectedKind.value && item.fileName === selectedFileName.value) return
  if (dirty.value) {
    pendingDocument.value = item
    localDiscardGuardOpen.value = true
    return
  }
  emit('read', { kind: item.kind, fileName: item.fileName })
}

function clearPendingDiscard() {
  pendingDocument.value = undefined
  pendingDirtyAction.value = undefined
  localDiscardGuardOpen.value = false
}

function cancelPendingDiscard() {
  const external = Boolean(props.discardGuardOpen && !localDiscardGuardOpen.value)
  clearPendingDiscard()
  if (external) emit('cancelDiscard')
}

function confirmPendingDiscard() {
  const next = pendingDocument.value
  const action = pendingDirtyAction.value
  const external = Boolean(props.discardGuardOpen && !localDiscardGuardOpen.value)
  if (external) {
    emit('confirmDiscard')
    return
  }
  clearPendingDiscard()
  if (next) {
    emit('read', { kind: next.kind, fileName: next.fileName })
    return
  }
  if (action) openDirtyAction(action, true)
}

function handleDiscardGuardOpen(open: boolean) {
  if (!open) cancelPendingDiscard()
}

function requestDirtyAction(action: 'create' | 'rename' | 'delete') {
  if (!dirty.value) {
    openDirtyAction(action, false)
    return
  }
  pendingDirtyAction.value = action
  localDiscardGuardOpen.value = true
}

function openDirtyAction(action: 'create' | 'rename' | 'delete', discarded: boolean) {
  if (discarded && document.value) source.value = document.value.source
  if (action === 'create') {
    createKind.value = 'core'
    createFileName.value = ''
    createDialogOpen.value = true
  }
  if (action === 'rename') {
    if (!document.value) return
    renameFileName.value = document.value.fileName
    renameDialogOpen.value = true
  }
  if (action === 'delete') deleteDialogOpen.value = true
}

function openCreateDialog() {
  requestDirtyAction('create')
}

async function createDocument() {
  const fileName = normalizedCreateFileName.value
  if (!fileName) return
  try {
    await new Promise<void>((resolve, reject) => emit('create', {
      kind: createKind.value,
      fileName,
      source: initialSource(createKind.value),
    }, resolve, reject))
    createDialogOpen.value = false
  } catch {
    // Shell 已把规范化错误写入页面状态，保持对话框打开供用户修正。
  }
}

function openRenameDialog() {
  if (!document.value) return
  requestDirtyAction('rename')
}

async function renameDocument() {
  const current = document.value
  const newFileName = normalizedRenameFileName.value
  if (!current || !newFileName) return
  try {
    await new Promise<void>((resolve, reject) => emit('rename', {
      kind: current.kind,
      fileName: current.fileName,
      newFileName,
      expectedRevision: current.revision,
      confirmed: true,
    }, resolve, reject))
    renameDialogOpen.value = false
  } catch (error) {
    if (/revision|已被其他操作修改/.test(errorMessage(error))) conflictDialogOpen.value = true
  }
}

async function deleteDocument() {
  const current = document.value
  if (!current) return
  try {
    await new Promise<void>((resolve, reject) => emit('delete', {
      kind: current.kind,
      fileName: current.fileName,
      expectedRevision: current.revision,
      confirmed: true,
    }, resolve, reject))
    deleteDialogOpen.value = false
  } catch (error) {
    if (/revision|已被其他操作修改/.test(errorMessage(error))) conflictDialogOpen.value = true
  }
}

async function saveDocument() {
  const current = document.value
  if (!current || !dirty.value) return
  saveStatus.value = 'saving'
  try {
    await new Promise<void>((resolve, reject) => emit('save', {
      kind: current.kind,
      fileName: current.fileName,
      source: source.value,
      expectedRevision: current.revision,
    }, resolve, reject))
    saveStatus.value = 'saved'
  } catch (error) {
    saveStatus.value = 'error'
    if (/revision|已被其他操作修改/.test(errorMessage(error))) conflictDialogOpen.value = true
  }
}

function reloadConflict() {
  const current = document.value
  if (current) emit('read', { kind: current.kind, fileName: current.fileName })
  conflictDialogOpen.value = false
}

function failedLocateResult(message: string): LocateStudioPresetExpressionResult {
  return { status: 'failed', code: 'request-not-observed', message }
}

async function resolveLocatedExpression(expression: StudioPresetExpression): Promise<LocateStudioPresetExpressionResult> {
  const current = document.value
  if (!current || dirty.value) return failedLocateResult('请先保存当前源码，再查看最新请求中的值。')
  try {
    return await new Promise<LocateStudioPresetExpressionResult>((resolve, reject) => emit('locate', {
      document: { kind: current.kind, fileName: current.fileName, revision: current.revision },
      expression: { stableId: expression.stableId },
    }, resolve, reject))
  } catch (error) {
    return failedLocateResult(errorMessage(error))
  }
}

async function resolveExpressionValue(expression: StudioPresetExpression): Promise<PresetExpressionObservedValueResult> {
  const located = await resolveLocatedExpression(expression)
  if (located.status === 'failed') return resolvePresetExpressionObservedValue(located)
  try {
    const detail = await new Promise<StudioModelRequestDetail>((resolve, reject) => emit('readRequest', {
      recordId: located.recordId,
    }, resolve, reject))
    return resolvePresetExpressionObservedValue(located, detail)
  } catch (error) {
    return { status: 'failed', message: errorMessage(error) }
  }
}

async function locateExpression(expression: StudioPresetExpression) {
  locateMessage.value = ''
  locateFailed.value = false
  const result = await resolveLocatedExpression(expression)
  if (result.status === 'failed') {
    locateFailed.value = true
    locateMessage.value = result.message
    return
  }
  locateMessage.value = '已找到使用当前预设快照的模型请求证据，正在打开精确位置…'
  emit('navigateEvidence', result, captureOrigin())
}

function captureOrigin(): PresetOriginSnapshot {
  const editorScroll = editor.value?.captureScrollSnapshot()
  return markRaw({
    listScrollTop: listElement.value?.scrollTop ?? 0,
    searchQuery: searchQuery.value,
    ...(editorScroll ? { editorScroll: markRaw(editorScroll) } : {}),
  })
}

function normalizeFileName(value: string) {
  const fileName = value.trim()
  if (!fileName) return ''
  return fileName.endsWith('.yml') ? fileName : `${fileName}.yml`
}

function initialSource(kind: PresetDocumentKind) {
  return kind === 'character' ? 'name: 新角色\n' : 'keywords:\n  - 新预设\n'
}

function kindLabel(kind: PresetDocumentKind) {
  return kind === 'core' ? 'ChatLuna' : 'Character'
}

function formatModifiedAt(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || '操作失败')
}
</script>
