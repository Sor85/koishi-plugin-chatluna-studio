export type StudioWorkspaceView = 'model-requests' | 'presets'

export interface StudioWorkspacePreferences {
  currentView: StudioWorkspaceView
}

interface WorkspaceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'chatluna-studio.workspace'
const DEFAULT_PREFERENCES: StudioWorkspacePreferences = { currentView: 'model-requests' }
const WORKSPACE_VIEWS = new Set<StudioWorkspaceView>(['model-requests', 'presets'])

/**
 * 当前视图按浏览器保存，不进服务端。
 *
 * 它是每个人自己的观察位置：两个人同时开着控制台时，一方切到预设不该把另一方也拽过去。
 * 读取要能容忍任何存量内容——第三方扩展、旧版本、手改过的 localStorage 都可能留下别的形状，
 * 解析失败时退回默认视图，而不是让页面在挂载阶段抛异常。
 */
export function loadWorkspacePreferences(storage: Pick<WorkspaceStorage, 'getItem'>): StudioWorkspacePreferences {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as Partial<StudioWorkspacePreferences>
    const currentView = value.currentView && WORKSPACE_VIEWS.has(value.currentView)
      ? value.currentView
      : DEFAULT_PREFERENCES.currentView
    return { currentView }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

export function saveWorkspacePreferences(
  storage: Pick<WorkspaceStorage, 'setItem'>,
  preferences: StudioWorkspacePreferences,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}
