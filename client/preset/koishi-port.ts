import { send } from '@koishijs/client'
import type { PresetPort } from './port'

export function createKoishiPresetPort(): PresetPort {
  return {
    // 预设文件是全局 ChatLuna 资源；仅定位表达式的 input 自身携带明确 scope，均不注入当前工作区 spaceId。
    getPresetCatalog: (input = {}) => send('chatluna-studio/preset-catalog', input),
    readPreset: (input) => send('chatluna-studio/preset-read', input),
    createPreset: (input) => send('chatluna-studio/preset-create', input),
    savePreset: (input) => send('chatluna-studio/preset-save', input),
    renamePreset: (input) => send('chatluna-studio/preset-rename', input),
    deletePreset: (input) => send('chatluna-studio/preset-delete', input),
    locatePresetExpression: (input) => send('chatluna-studio/preset-locate-expression', input),
  }
}
