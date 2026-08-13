/**
 * 7d7d host 半端：在 DSH 主 webserver 上注册 `/7d7d` 前缀路由，游戏库
 * 全部走主服务器同源路径（相对 URL，任何访问路径——loopback、LAN、代理——
 * 都能用；游戏与 GUI 同源但由 iframe sandbox 隔离，见 server.ts 模块注释）。
 * 游戏库默认在 `$DSH_HOME/7d7d`（缺省 ~/.dsh/7d7d），首次运行从本插件
 * seed-games/ 拷贝种子游戏。
 * @module 7d7d
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 类型侧拉入 ctx.webServer 声明（模块增强）。
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { createGamesRouter } from './server.ts'

/** 稳定插件名。 */
export const name = '7d7d'

/** 所需服务：web 形态 HTTP 载体（register 游戏前缀路由）。 */
export const inject = ['webServer']

/** 插件配置。 */
export interface Config {
  /** 游戏库根目录（缺省 $DSH_HOME/7d7d）。 */
  root?: string
  /** 首次运行时是否从 seed-games/ 拷贝种子游戏（缺省 true）。 */
  seed?: boolean
  /**
   * 是否同步社区游戏（缺省 true）：把插件仓库 community-games/ 里的游戏
   * 拷进游戏库（零网络零认证；仓库 git pull 即获更新）。关闭后连手动
   * 「⇅ 社区同步」也不可用。
   */
  syncCommunity?: boolean
  /** 远程社区 catalog.json URL（可选）：配置后同步时追加拉取。 */
  communityCatalogUrl?: string
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
  seed: z.boolean().default(true),
  syncCommunity: z.boolean().default(true),
  communityCatalogUrl: z.string().default(''),
})

/** 游戏路由挂载前缀（主服务器同源路径）。 */
export const MOUNT_BASE = '/7d7d'

/** 服务信息路由（诊断用；客户端直接使用同源相对路径，不做端口发现）。 */
export const SERVER_INFO_PATH = `${MOUNT_BASE}/api/server.json`

/**
 * 插件主体。
 * @param ctx - cordis 上下文。
 * @param config - 见 {@link Config}。
 */
export function apply(ctx: Context, config: Config): void {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const root = config.root !== undefined && config.root !== '' ? config.root : join(dshHome, '7d7d')
  // lib/index.js 位于 <repo>/lib，插件根 = <repo>。
  const pluginRoot = fileURLToPath(new URL('../', import.meta.url))
  const seedDir = config.seed === false ? undefined : join(pluginRoot, 'seed-games')
  const ruffleDir = join(pluginRoot, 'vendor', 'ruffle', 'runtime-0.5.0')
  const communitySourceDir = config.syncCommunity === false ? undefined : join(pluginRoot, 'community-games')
  const communityCatalogUrl = config.communityCatalogUrl !== '' ? config.communityCatalogUrl : undefined

  const router = createGamesRouter({
    root,
    seedDir,
    ruffleDir,
    communitySourceDir,
    communityCatalogUrl,
  }, MOUNT_BASE)

  const serverInfoRoute: WebRoute = {
    kind: 'exact',
    path: SERVER_INFO_PATH,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end()
        return
      }
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      })
      res.end(JSON.stringify({
        name: '7d7d',
        base: MOUNT_BASE,
        manifest: `${MOUNT_BASE}/api/manifest.json`,
      }))
    },
  }

  ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'prefix', path: MOUNT_BASE, handler: router.handler })
    const disposeInfo = ctx.webServer.register(serverInfoRoute)
    // 启动同步（尽力而为，失败不致命；手动触发走 POST <base>/api/sync）。
    void router.sync()
    ctx.logger.info?.(`[7d7d] games portal mounted at ${MOUNT_BASE} (library: ${root})`)
    return () => {
      dispose()
      disposeInfo()
    }
  }, '7d7d: games routes')
}
