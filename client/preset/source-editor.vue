<template>
  <div ref="editorElement" class="chatluna-studio-preset-source-editor" aria-label="预设 YAML 源码编辑器" />
</template>

<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { yaml } from '@codemirror/lang-yaml'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip, type DecorationSet, type Tooltip, type ViewUpdate } from '@codemirror/view'
import { IconExternalLink } from '@tabler/icons-vue'
import { tags } from '@lezer/highlight'
import { createApp, h, markRaw, onBeforeUnmount, onMounted, ref, toRaw, watch, type DeepReadonly } from 'vue'
import { Button } from '#client/components/ui/button'
import { attachStudioScrollbar, type StudioScrollbarHandle } from '#client/shared/scrollbar'
import {
  codeMirrorOffset,
  resolvePresetSourceExpressions,
  type PresetSourceEditorExpression,
} from './source-expressions'
import type { PresetExpressionObservedValueResult } from './expression-value'
import type { PresetDocumentKind, StudioPresetExpression } from '../../src/presets'

const props = defineProps<{
  modelValue: string
  kind: PresetDocumentKind
  expressions: readonly DeepReadonly<StudioPresetExpression>[]
  loadedSource: string
  readOnly?: boolean
  resolveExpressionValue?: (expression: StudioPresetExpression) => Promise<PresetExpressionObservedValueResult>
  scrollTo?: StateEffect<unknown>
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  expressionClick: [expression: StudioPresetExpression]
}>()

const editorElement = ref<HTMLElement>()
let view: EditorView | undefined
let scrollbar: StudioScrollbarHandle | undefined
let activeExpressions: readonly PresetSourceEditorExpression[] = []

const presetEditorTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
  },
  '.cm-content': {
    padding: '18px 0 28px',
    caretColor: 'var(--chatluna-studio-accent)',
  },
  '.cm-line': {
    padding: '0 20px 0 14px',
    lineHeight: '1.72',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--chatluna-studio-accent)',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--chatluna-studio-accent) 20%, transparent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--chatluna-studio-accent) 6%, transparent)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '32px',
    padding: '0 6px 0 4px',
    lineHeight: '1.72',
  },
  '.cm-activeLineGutter': {
    color: 'var(--chatluna-studio-text)',
    fontWeight: '600',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 3px 0 0',
    lineHeight: '1.72',
  },
  '.cm-foldPlaceholder': {
    margin: '0 4px',
    padding: '0 6px',
    border: '1px solid var(--chatluna-studio-border)',
    borderRadius: '5px',
    color: 'var(--chatluna-studio-muted)',
    backgroundColor: 'var(--chatluna-studio-surface-muted)',
  },
  '.cm-panels': {
    color: 'var(--chatluna-studio-text)',
    backgroundColor: 'var(--chatluna-studio-panel)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--chatluna-studio-border)',
  },
  '.cm-searchMatch': {
    borderRadius: '3px',
    backgroundColor: 'color-mix(in srgb, #f59e0b 28%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--chatluna-studio-accent) 28%, transparent)',
  },
})

const presetHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, class: 'chatluna-studio-preset-token-comment' },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], class: 'chatluna-studio-preset-token-key' },
  { tag: [tags.string, tags.special(tags.string)], class: 'chatluna-studio-preset-token-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'chatluna-studio-preset-token-literal' },
  { tag: [tags.punctuation, tags.separator], class: 'chatluna-studio-preset-token-punctuation' },
  { tag: [tags.keyword, tags.atom], class: 'chatluna-studio-preset-token-keyword' },
])

const editorBaseExtensions: Extension[] = [
  basicSetup,
  yaml(),
  presetEditorTheme,
  syntaxHighlighting(presetHighlightStyle),
]

const setDecorations = StateEffect.define<DecorationSet>()
const syncDocument = StateEffect.define<boolean>()
const decorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    let next = decorations.map(transaction.changes)
    for (const effect of transaction.effects) if (effect.is(setDecorations)) next = effect.value
    return next
  },
  provide: field => EditorView.decorations.from(field),
})

function expressionDecorations(
  source: string,
  expressions: readonly PresetSourceEditorExpression[],
) {
  return Decoration.set(expressions.flatMap((expression) => {
    const sourceFrom = Math.max(0, Math.min(source.length, expression.range.start))
    const sourceTo = Math.max(sourceFrom, Math.min(source.length, expression.range.end))
    if (sourceTo <= sourceFrom || source[sourceFrom] !== '{' || source[sourceTo - 1] !== '}') return []
    const from = codeMirrorOffset(source, sourceFrom)
    const to = codeMirrorOffset(source, sourceTo)
    return [Decoration.mark({
      class: expression.kind === 'control'
        ? 'chatluna-studio-preset-expression is-control'
        : 'chatluna-studio-preset-expression is-value',
      attributes: expression.clickable && expression.stableId
        ? { 'data-preset-expression-id': expression.stableId }
        : { 'data-preset-expression': expression.kind },
    }).range(from, to)]
  }), true)
}

function expressionValueTooltip(): Extension {
  return hoverTooltip(async (_view, pos) => {
    const expression = activeExpressions.find((candidate) => (
      candidate.kind === 'value'
      && candidate.clickable
      && candidate.stableId
      && pos >= codeMirrorOffset(props.modelValue, candidate.range.start)
      && pos <= codeMirrorOffset(props.modelValue, candidate.range.end)
    ))
    if (!expression || !props.resolveExpressionValue) return null

    const result = await props.resolveExpressionValue(expression as StudioPresetExpression)
    return expressionTooltip(result, expression)
  }, { hoverTime: 180, hideOnChange: true })
}

function expressionTooltip(
  result: PresetExpressionObservedValueResult,
  expression: PresetSourceEditorExpression,
): Tooltip {
  const from = codeMirrorOffset(props.modelValue, expression.range.start)
  const to = codeMirrorOffset(props.modelValue, expression.range.end)
  return {
    pos: from,
    end: to,
    above: true,
    create() {
      const dom = document.createElement('div')
      dom.className = 'chatluna-studio-preset-expression-tooltip'
      if (result.status === 'failed') {
        dom.classList.add('is-error')
        dom.textContent = result.message
        return { dom }
      }
      const header = document.createElement('div')
      header.className = 'chatluna-studio-preset-expression-tooltip-header'
      const label = document.createElement('span')
      label.className = 'chatluna-studio-preset-expression-tooltip-label'
      label.textContent = '最新请求中的值'
      const value = document.createElement('pre')
      value.className = 'chatluna-studio-preset-expression-tooltip-value'
      value.textContent = result.value || '（空字符串）'
      const time = document.createElement('time')
      time.dateTime = result.requestCreatedAt
      time.textContent = new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).format(new Date(result.requestCreatedAt))
      const action = document.createElement('div')
      action.className = 'chatluna-studio-preset-expression-tooltip-action'
      const app = createApp({
        render: () => h(Button, {
          size: 'xs',
          variant: 'ghost',
          class: 'chatluna-studio-preset-expression-tooltip-link',
          onClick: () => emit('expressionClick', expression as StudioPresetExpression),
        }, () => [
          h(IconExternalLink, { 'data-icon': 'inline-start', 'aria-hidden': 'true' }),
          '查看模型请求',
        ]),
      })
      app.mount(action)
      header.append(label, action)
      dom.append(header, value, time)
      return { dom, destroy: () => app.unmount() }
    },
  }
}

function dispatchDecorations(source = props.modelValue) {
  if (!view) return
  activeExpressions = resolvePresetSourceExpressions({
    kind: props.kind,
    source,
    loadedSource: props.loadedSource,
    serverExpressions: props.expressions,
  })
  view.dispatch({ effects: setDecorations.of(expressionDecorations(source, activeExpressions)) })
}

function handleDocumentUpdate(update: ViewUpdate) {
  if (!update.docChanged) return
  const value = update.state.doc.toString()
  if (!update.transactions.some(transaction => transaction.effects.some(effect => effect.is(syncDocument)))) {
    dispatchDecorations(value)
  }
  if (update.transactions.some(transaction => transaction.isUserEvent('input'))) {
    emit('update:modelValue', value)
  }
}

function editorExtensions(readOnly = Boolean(props.readOnly)): Extension[] {
  return [
    ...editorBaseExtensions,
    decorationField,
    expressionValueTooltip(),
    EditorView.lineWrapping,
    EditorView.editable.of(!readOnly),
    EditorState.readOnly.of(readOnly),
    EditorView.updateListener.of(handleDocumentUpdate),
  ]
}

function captureScrollSnapshot() {
  const snapshot = view?.scrollSnapshot()
  return snapshot ? markRaw(snapshot) : undefined
}

function restoreScrollSnapshot(scrollTo = toRaw(props.scrollTo)) {
  if (!view || !scrollTo) return
  view.dispatch({ effects: scrollTo })
}

onMounted(() => {
  if (!editorElement.value) return
  const scrollTo = toRaw(props.scrollTo)
  view = new EditorView({
    parent: editorElement.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: editorExtensions(),
    }),
    ...(scrollTo ? { scrollTo } : {}),
  })
  // 滚动容器是 CodeMirror 自己建的，模板里没有这个节点，指令挂不上去，只能命令式挂载。它必须挂：
  // 源码要延伸到毛玻璃顶栏背后才有内容可采样，而原生轨道从滚动容器顶缘起画且无法裁剪，会跟着钻
  // 进顶栏；自定义轨道的顶缘由顶栏底缘顶下来。
  scrollbar = attachStudioScrollbar(view.scrollDOM)
  dispatchDecorations()
  // 构造时高度还没量完，快照要等一帧再 dispatch，否则会按未测量行高滚回顶部。
  if (scrollTo) requestAnimationFrame(() => restoreScrollSnapshot(scrollTo))
})

defineExpose({ captureScrollSnapshot })

watch(() => props.modelValue, (value) => {
  if (!view) return
  if (value === view.state.doc.toString()) {
    dispatchDecorations(value)
    return
  }
  activeExpressions = resolvePresetSourceExpressions({
    kind: props.kind,
    source: value,
    loadedSource: props.loadedSource,
    serverExpressions: props.expressions,
  })
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    effects: [
      syncDocument.of(true),
      setDecorations.of(expressionDecorations(value, activeExpressions)),
    ],
  })
})

watch([() => props.kind, () => props.loadedSource, () => props.expressions], () => dispatchDecorations(), { deep: true })

watch(() => props.readOnly, (readOnly) => {
  if (!view) return
  view.dispatch({
    effects: StateEffect.reconfigure.of(editorExtensions(Boolean(readOnly))),
  })
  dispatchDecorations()
})

onBeforeUnmount(() => {
  // 轨道挂在 body 上，先摘再销毁编辑器：view.destroy() 之后 scrollDOM 已经离开文档，
  // 轨道元素会留在 body 里成为孤儿。
  scrollbar?.detach()
  scrollbar = undefined
  view?.destroy()
})
</script>
