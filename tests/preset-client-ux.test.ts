import { describe, expect, it } from 'vitest'
import { createPresetDirtyGuard } from '../client/preset/dirty-guard'
import { codeMirrorOffset, resolvePresetSourceExpressions } from '../client/preset/source-expressions'
import { expressionStableId, parsePresetSourceDocument } from '../src/presets'

describe('预设客户端 UX 纯 seam', () => {
  it('把 CRLF 原始源码范围转换成 CodeMirror 的 LF 文档范围', () => {
    const source = 'input: |-\r\n  first\r\n  天气:{weather}\r\n'
    const start = source.indexOf('{weather}')
    const end = start + '{weather}'.length
    const normalized = source.replaceAll('\r\n', '\n')

    expect(normalized.slice(codeMirrorOffset(source, start), codeMirrorOffset(source, end))).toBe('{weather}')
  })

  it('源码未修改时沿用服务端表达式身份，并保留值表达式点击能力', () => {
    const source = `system: Hello {name}\ninput: '{if ready}{prompt}{/if}'\n`
    const serverExpressions = parsePresetSourceDocument('character', source).expressions.map((expression) => ({
      ...expression,
      stableId: expressionStableId(expression),
    }))

    const expressions = resolvePresetSourceExpressions({
      kind: 'character',
      source,
      loadedSource: source,
      serverExpressions,
    })

    expect(expressions).toBe(serverExpressions)
    expect(expressions.map(({ kind, clickable, stableId }) => ({ kind, clickable, stableId }))).toEqual([
      { kind: 'value', clickable: true, stableId: '["system"]#0' },
      { kind: 'control', clickable: false, stableId: '["input"]#0' },
      { kind: 'value', clickable: true, stableId: '["input"]#1' },
      { kind: 'control', clickable: false, stableId: '["input"]#2' },
    ])
  })

  it('源码修改后按当前 YAML 重算值与控制范围，但全部禁用点击且不制造服务端身份', () => {
    const loadedSource = `system: Hello {old}\ninput: '{if ready}{oldPrompt}{/if}'\n`
    const source = `system: "Hello {{escaped}} {newName}"\ninput: |-\n  {if ready}{newPrompt}{/if}\n`
    const serverExpressions = parsePresetSourceDocument('character', loadedSource).expressions.map((expression) => ({
      ...expression,
      stableId: expressionStableId(expression),
    }))

    const expressions = resolvePresetSourceExpressions({
      kind: 'character',
      source,
      loadedSource,
      serverExpressions,
    })

    expect(expressions.map((expression) => ({
      text: source.slice(expression.range.start, expression.range.end),
      kind: expression.kind,
      clickable: expression.clickable,
      stableId: expression.stableId,
    }))).toEqual([
      { text: '{newName}', kind: 'value', clickable: false, stableId: undefined },
      { text: '{if ready}', kind: 'control', clickable: false, stableId: undefined },
      { text: '{newPrompt}', kind: 'value', clickable: false, stableId: undefined },
      { text: '{/if}', kind: 'control', clickable: false, stableId: undefined },
    ])
  })

  it('脏状态统一拦截操作，只有显式丢弃才返回待执行动作', () => {
    const guard = createPresetDirtyGuard()
    guard.update(true)

    expect(guard.request({ action: 'create' })).toBe(false)
    expect(guard.peek().pending).toEqual({ action: 'create' })
    guard.cancel()
    expect(guard.peek()).toEqual({ dirty: true })

    expect(guard.request({ action: 'leave', targetView: 'model-requests' })).toBe(false)
    expect(guard.discard()).toEqual({ action: 'leave', targetView: 'model-requests' })
    expect(guard.peek()).toEqual({ dirty: false })
    expect(guard.request({ action: 'delete' })).toBe(true)
  })
})
