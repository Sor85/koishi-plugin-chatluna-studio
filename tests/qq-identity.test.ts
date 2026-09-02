import { describe, expect, it } from 'vitest'
import {
  formatConversationLabel,
  resolveBotIdentity,
  resolveConversationIdentity,
  resolveQQGroupAvatar,
  resolveQQUserAvatar,
} from '../client/shared/qq-identity'

/**
 * 记录里的会话身份怎么变成界面上的一行字与一张头像。
 *
 * 头像地址是由号码算出的公开地址，因此这里的断言就是「哪些情况允许算、算出来是什么」——
 * 非 QQ 系平台的数字账号算出来会是别人的头像，这条边界必须钉住。
 */

const groupEntities = {
  platform: 'onebot',
  botId: '10001',
  botName: '小助手',
  conversationId: '20002',
  conversationName: '测试群',
  conversationType: 'group' as const,
  guildId: '20002',
  userId: '30003',
  userName: '提问的人',
}

const privateEntities = {
  platform: 'onebot',
  botId: '10001',
  conversationId: 'private:30003',
  conversationType: 'private' as const,
  userId: '30003',
  userName: '好友',
}

describe('QQ 头像地址', () => {
  it('QQ 系平台按号码拼用户与群头像', () => {
    expect(resolveQQUserAvatar('onebot', '10001')).toBe('https://q.qlogo.cn/headimg_dl?dst_uin=10001&spec=100')
    expect(resolveQQUserAvatar('onebot', 'private:30003')).toBe('https://q.qlogo.cn/headimg_dl?dst_uin=30003&spec=100')
    expect(resolveQQGroupAvatar('onebot', '20002')).toBe('https://p.qlogo.cn/gh/20002/20002/100')
  })

  it('非 QQ 平台、缺平台或非号码标识一律不拼', () => {
    expect(resolveQQUserAvatar('telegram', '10001')).toBeUndefined()
    expect(resolveQQUserAvatar(undefined, '10001')).toBeUndefined()
    expect(resolveQQUserAvatar('onebot', 'abc')).toBeUndefined()
    expect(resolveQQUserAvatar('onebot', '123')).toBeUndefined()
  })
})

describe('会话身份展示', () => {
  it('机器人优先用快照昵称，缺昵称退回号码', () => {
    expect(resolveBotIdentity(groupEntities, { useQQAvatars: true })).toEqual({
      name: '小助手',
      avatar: 'https://q.qlogo.cn/headimg_dl?dst_uin=10001&spec=100',
    })
    expect(resolveBotIdentity({ botId: '10001', platform: 'onebot' }, { useQQAvatars: false }))
      .toEqual({ name: '机器人 10001' })
  })

  it('未归属记录说自己未归属，而不是变成一个无名机器人', () => {
    expect(resolveBotIdentity({}, { useQQAvatars: true })).toEqual({ name: '未归属请求' })
    expect(resolveConversationIdentity({}, { useQQAvatars: true })).toEqual({ name: '未归属会话' })
  })

  it('群聊取群头像，私聊取对方头像', () => {
    expect(resolveConversationIdentity(groupEntities, { useQQAvatars: true })).toEqual({
      name: '测试群',
      avatar: 'https://p.qlogo.cn/gh/20002/20002/100',
    })
    expect(resolveConversationIdentity(privateEntities, { useQQAvatars: true })).toEqual({
      name: '好友',
      avatar: 'https://q.qlogo.cn/headimg_dl?dst_uin=30003&spec=100',
    })
  })

  it('关掉 QQ 头像后只剩名字，不发起任何外部请求', () => {
    expect(resolveConversationIdentity(groupEntities, { useQQAvatars: false })).toEqual({ name: '测试群' })
    expect(resolveBotIdentity(groupEntities, { useQQAvatars: false })).toEqual({ name: '小助手' })
  })

  it('缺少会话名时按类型兜出可指认的名字', () => {
    expect(resolveConversationIdentity(
      { platform: 'onebot', conversationId: '20002', conversationType: 'group', guildId: '20002' },
      { useQQAvatars: false },
    ).name).toBe('群 20002')
    expect(resolveConversationIdentity(
      { platform: 'onebot', conversationId: 'private:30003', conversationType: 'private' },
      { useQQAvatars: false },
    ).name).toBe('30003')
  })

  it('列表徽标一行说明带类型前缀', () => {
    expect(formatConversationLabel(groupEntities)).toBe('群聊 · 测试群')
    expect(formatConversationLabel(privateEntities)).toBe('私聊 · 好友')
    expect(formatConversationLabel({})).toBe('未归属')
  })
})
