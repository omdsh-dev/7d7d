/**
 * 7d7d 浏览器半端：注册 conversation.view 槽条目 —— 会话标签栏
 * chat / Trajectory 之后出现 7D7D 标签，点击即在对话列内打开游戏门户。
 * 与 ui-trajectory 同款注册形态：纯读取、不定义服务，卸载即移除标签。
 * @module 7d7d/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: 把 conversation.view 槽行声明拉进类型图（register 调用才能过类型检查）。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PortalView, type PortalViewInjected } from './PortalView.tsx'
import './portal.css'

/** 稳定插件名。 */
export const name = '7d7d-client'

/** 所需服务：槽注册表（conversation.view 由 ui-conversation 声明，我们只注条目）。 */
export const inject = ['slots']

/**
 * 插件主体：注册 7D7D 视图标签。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: '7d7d',
    // chat=0 / trajectory=10 → 7d7d 排在 Trajectory 之后。
    order: 20,
    label: '7D7D',
    inject: (_sessionId: SessionId): PortalViewInjected => ({}),
  }, PortalView))
}
