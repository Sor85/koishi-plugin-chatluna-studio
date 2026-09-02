import { Context, icons } from '@koishijs/client'
import Page from '#client/workspace/page.vue'
import StudioActivityIcon from '#client/shared/studio-activity-icon.vue'
import { installContextModelRequestReceiver } from '#client/workspace/koishi-port'
import './style.css'

// 控制台内置图标表里没有合适的条目，必须注册自定义图标，否则侧边栏入口显示为空白。
icons.register('activity:chatluna-studio', StudioActivityIcon)

export default (ctx: Context) => {
  installContextModelRequestReceiver(ctx)
  ctx.page({
    name: 'ChatLuna 工作室',
    path: '/chatluna-studio',
    icon: 'activity:chatluna-studio',
    order: 300,
    authority: 4,
    component: Page,
  })
}
