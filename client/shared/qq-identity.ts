import type { StudioModelRequestEntities } from '../../src/types'

/**
 * 真实 OneBot 会话在界面上的身份：一个名字，加上可选的头像地址。
 *
 * 名字优先用采集时快照下来的昵称与群名，取不到才退回号码——记录必须能被指认，而「显示成一串
 * 号码」和「显示成空白」在列表里差别很大。
 *
 * 头像地址在这里拼而不是由服务端给出：它是一个可由号码算出的公开地址，让服务端把它写进每条
 * 记录，等于把一个纯展示决定（要不要外链）冻结进持久化数据里，配置改了旧记录也不会跟着变。
 */

export interface StudioIdentityDisplay {
  name: string
  avatar?: string
}

/** 只有 QQ 系平台的号码能拼出 QQ 头像地址；其他平台的数字账号拼出来会是别人的头像。 */
const QQ_PLATFORMS = new Set(['onebot', 'qq', 'red', 'chronocat', 'napcat', 'llonebot'])

export interface StudioIdentityOptions {
  useQQAvatars: boolean
}

function readQQUin(platform: string | undefined, rawId: string | undefined): string | undefined {
  if (!platform || !QQ_PLATFORMS.has(platform.toLowerCase()) || !rawId) return
  // OneBot 私聊会话是 `private:<账号>`，群聊会话直接是群号。
  const id = rawId.startsWith('private:') ? rawId.slice('private:'.length) : rawId
  return /^\d{5,15}$/.test(id) ? id : undefined
}

export function resolveQQUserAvatar(
  platform: string | undefined,
  userId: string | undefined,
): string | undefined {
  const uin = readQQUin(platform, userId)
  return uin ? `https://q.qlogo.cn/headimg_dl?dst_uin=${uin}&spec=100` : undefined
}

export function resolveQQGroupAvatar(
  platform: string | undefined,
  groupId: string | undefined,
): string | undefined {
  const gid = readQQUin(platform, groupId)
  return gid ? `https://p.qlogo.cn/gh/${gid}/${gid}/100` : undefined
}

/** 发起这次请求的机器人。未归属记录没有机器人可言，说明它就是未归属，而不是某个无名机器人。 */
export function resolveBotIdentity(
  entities: StudioModelRequestEntities,
  options: StudioIdentityOptions,
): StudioIdentityDisplay {
  const { platform, botId, botName } = entities
  if (!botId) return { name: '未归属请求' }
  const avatar = options.useQQAvatars ? resolveQQUserAvatar(platform, botId) : undefined
  return {
    name: botName || `机器人 ${botId}`,
    ...(avatar ? { avatar } : {}),
  }
}

/** 触发这次请求的会话。群聊取群头像，私聊取对方头像。 */
export function resolveConversationIdentity(
  entities: StudioModelRequestEntities,
  options: StudioIdentityOptions,
): StudioIdentityDisplay {
  const { platform, conversationId, conversationName, conversationType, guildId } = entities
  if (!conversationId) return { name: '未归属会话' }
  const avatar = options.useQQAvatars
    ? conversationType === 'group'
      ? resolveQQGroupAvatar(platform, guildId ?? conversationId)
      : resolveQQUserAvatar(platform, conversationId)
    : undefined
  return {
    name: conversationName || defaultConversationName(entities),
    ...(avatar ? { avatar } : {}),
  }
}

function defaultConversationName(entities: StudioModelRequestEntities): string {
  const { conversationId = '', conversationType, userName, userId } = entities
  if (conversationType === 'group') return `群 ${entities.guildId ?? conversationId}`
  return userName || (userId ? `用户 ${userId}` : conversationId.replace(/^private:/, '') || conversationId)
}

/** 列表徽标上的一行会话说明：类型 + 名字。 */
export function formatConversationLabel(
  entities: StudioModelRequestEntities,
  options: StudioIdentityOptions = { useQQAvatars: false },
): string {
  if (!entities.conversationId) return '未归属'
  const prefix = entities.conversationType === 'group' ? '群聊' : '私聊'
  return `${prefix} · ${resolveConversationIdentity(entities, options).name}`
}
