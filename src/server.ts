/**
 * 7d7d 游戏路由核心：挂载到 DSH 主服务器 /7d7d 前缀（同源，任何访问路径可用），
 * 也可作为独立服务器使用（测试用）。游戏内容与 GUI 同源但被 iframe sandbox
 * （无 allow-same-origin，不透明 origin）隔离；CORS `*` 只放行游戏自身的
 * 子资源读取（如 Ruffle 的 wasm），游戏仍然摸不到带 trust fence 的 /api 桥接。
 * 路由（base = '' 或 '/7d7d'）：
 *   <base>/api/manifest.json   门户清单（每次实时扫描；含本地 + 社区）
 *   <base>/api/sync            POST：手动触发一次社区游戏同步
 *   <base>/g/<slug>/…          游戏静态资源（目录默认 index.html；本地优先，其次社区）
 *   <base>/player/<slug>       Flash 播放页（Ruffle）
 *   <base>/ruffle/…            自托管 Ruffle 资源（vendor/ruffle，可选）
 *   <base>/                    服务信息
 * @module 7d7d/server
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { syncCommunity, syncCommunityLocal, type CommunitySyncResult } from './community.ts'
import { COMMUNITY_DIR, readGame, readManifest } from './manifest.ts'
import { renderPlayerPage } from './player.ts'
import { serveStatic } from './static.ts'
import type { GameMeta } from './types.ts'

/** 游戏路由选项（createGamesRouter / createGamesServer 共用）。 */
export interface GamesRouteOptions {
  /** 游戏库根目录；其下 games/ 为游戏目录集合。 */
  root: string
  /** 种子游戏目录：games/ 为空时把这里的游戏拷入。 */
  seedDir?: string
  /** 自托管 Ruffle 目录（可选，对应 /ruffle/ 前缀）。 */
  ruffleDir?: string
  /** 插件仓库内的社区游戏目录（<仓库>/community-games）；设置后自动同步。 */
  communitySourceDir?: string
  /** 远程社区 catalog.json URL（可选）。 */
  communityCatalogUrl?: string
  /** 可注入抓取器（测试用），透传给远程社区同步。 */
  fetcher?: (url: string) => Promise<Response>
  /** 进度日志（缺省 console）。 */
  log?: (message: string) => void
}

/** 可挂载的游戏路由：handler 接主服务器请求，sync 触发社区同步（互斥串行）。 */
export interface GamesRouter {
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>
  sync(): Promise<CommunitySyncResult>
}

/** 独立游戏库服务器句柄（仅测试/调试用；生产走主服务器前缀路由）。 */
export interface GamesServerHandle {
  port: number
  url: string
  close(): Promise<void>
}

/** 游戏库子目录名。 */
const GAMES = 'games'

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

/** games/ 为空且 seedDir 存在时，把种子游戏拷入（只执行一次）。 */
async function seedIfNeeded(gamesDir: string, seedDir: string | undefined): Promise<void> {
  if (seedDir === undefined) return
  let seedEntries
  try {
    seedEntries = await readdir(seedDir, { withFileTypes: true })
  } catch {
    return
  }
  let existing
  try {
    existing = await readdir(gamesDir)
  } catch {
    return
  }
  if (existing.length > 0) return
  for (const entry of seedEntries) {
    if (!entry.isDirectory()) continue
    try {
      await cp(join(seedDir, entry.name), join(gamesDir, entry.name), { recursive: true })
    } catch {
      // 单游戏种子失败不阻塞其余
    }
  }
}

/** 在游戏库里找一个游戏（读其 game.json；本地优先，其次社区）。 */
async function findGame(gamesDir: string, slug: string): Promise<GameMeta | null> {
  if (slug === '' || slug.includes('/') || slug.includes('\\') || slug.includes('..')) return null
  return await readGame(gamesDir, slug)
}

/** 解析游戏静态目录：games/<slug> 优先，其次 games/community/<slug>。 */
async function resolveGameDir(gamesDir: string, slug: string): Promise<string | null> {
  if (slug === '' || slug.includes('/') || slug.includes('\\') || slug.includes('..')) return null
  for (const base of [gamesDir, join(gamesDir, COMMUNITY_DIR)]) {
    try {
      if ((await stat(join(base, slug))).isDirectory()) return join(base, slug)
    } catch {
      // 继续尝试下一个基目录
    }
  }
  return null
}

/** 请求路径相对挂载基址裁剪：不在 base 下返回 null。 */
function stripBase(pathname: string, base: string): string | null {
  if (base === '') return pathname
  if (pathname === base) return '/'
  if (pathname.startsWith(base + '/')) return pathname.slice(base.length)
  return null
}

/**
 * 创建可挂载的游戏路由核心。
 * @param options - 见 {@link GamesRouteOptions}。
 * @param base - 挂载前缀（'' = 根挂载，'/7d7d' = 主服务器前缀）。
 * @returns 路由句柄；sync() 与 handler 共享互斥串行队列。
 */
export function createGamesRouter(options: GamesRouteOptions, base = ''): GamesRouter {
  const log = options.log ?? ((message: string) => { console.warn(`[7d7d] ${message}`) })
  const gamesDir = join(options.root, GAMES)

  // 就绪：建目录 + 首次播种（生产走主服务器路由时同样生效）。
  const ready: Promise<void> = (async () => {
    await mkdir(gamesDir, { recursive: true })
    await seedIfNeeded(gamesDir, options.seedDir)
  })().catch((error: unknown) => {
    log(`游戏库准备失败：${error instanceof Error ? error.message : String(error)}`)
  })

  // 社区同步闭包：本地仓库源（默认）+ 远程 catalog（可选），互斥串行。
  const localSync = options.communitySourceDir === undefined
    ? null
    : (): Promise<CommunitySyncResult> => syncCommunityLocal({
      gamesDir,
      sourceDir: options.communitySourceDir!,
      log,
    })
  const remoteSync = options.communityCatalogUrl === undefined
    ? null
    : (): Promise<CommunitySyncResult> => syncCommunity({
      gamesDir,
      catalogUrl: options.communityCatalogUrl!,
      fetcher: options.fetcher,
      log,
    })
  let syncTail: Promise<unknown> = Promise.resolve()
  const sync = (): Promise<CommunitySyncResult> => {
    if (localSync === null && remoteSync === null) {
      return Promise.resolve({ synced: [], skipped: [], failed: [] })
    }
    const run = syncTail.then(async (): Promise<CommunitySyncResult> => {
      const merged: CommunitySyncResult = { synced: [], skipped: [], failed: [] }
      if (localSync !== null) {
        const local = await localSync()
        merged.synced.push(...local.synced)
        merged.skipped.push(...local.skipped)
        merged.failed.push(...local.failed)
      }
      if (remoteSync !== null) {
        const remote = await remoteSync()
        merged.synced.push(...remote.synced)
        merged.skipped.push(...remote.skipped)
        merged.failed.push(...remote.failed)
      }
      if (merged.synced.length > 0) {
        log(`社区游戏同步完成：+${merged.synced.length}（跳过 ${merged.skipped.length}，失败 ${merged.failed.length}）`)
      }
      return merged
    })
    syncTail = run.catch(() => {})
    return run
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    await ready
    // 游戏子资源跨源读取（sandbox 不透明 origin 的 iframe 内 Ruffle wasm 等）。
    res.setHeader('access-control-allow-origin', '*')
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = stripBase(url.pathname, base)
    if (path === null) {
      sendText(res, 404, 'not found')
      return
    }

    // OPTIONS 预检：跨源 POST /api/sync 由浏览器预检。
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      })
      res.end()
      return
    }

    // 社区同步路由独立于 GET/HEAD 门（POST）。
    if (path === '/api/sync') {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST, OPTIONS' })
        res.end()
        return
      }
      sendJson(res, 200, await sync())
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD, OPTIONS' })
      res.end()
      return
    }
    const head = req.method === 'HEAD'

    if (path === '/api/manifest.json') {
      const manifest = await readManifest(gamesDir)
      if (head) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(); return }
      sendJson(res, 200, manifest)
      return
    }
    if (path === '/') {
      const manifest = await readManifest(gamesDir)
      if (head) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(); return }
      sendJson(res, 200, { name: '7d7d', base, manifest: `${base}/api/manifest.json`, games: manifest.games.length })
      return
    }
    const playerMatch = /^\/player\/([^/]+)$/.exec(path)
    if (playerMatch !== null) {
      let slug: string
      try {
        slug = decodeURIComponent(playerMatch[1] ?? '')
      } catch {
        sendText(res, 400, 'bad request')
        return
      }
      const game = await findGame(gamesDir, slug)
      if (game === null || game.type !== 'flash') {
        sendText(res, 404, 'not found')
        return
      }
      if (head) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(); return }
      const page = renderPlayerPage(game, `${base}/g/${slug}`, `${base}/ruffle/ruffle.js`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(page)
      return
    }
    if (path.startsWith('/g/')) {
      // /g/<slug>[/<rest>]：slug 之后的部分在游戏目录内解析。
      const rest = path.slice('/g'.length)
      const firstSlash = rest.indexOf('/', 1)
      const slugPart = firstSlash === -1 ? rest.slice(1) : rest.slice(1, firstSlash)
      const tail = firstSlash === -1 ? '' : rest.slice(firstSlash + 1)
      let slug: string
      try {
        slug = decodeURIComponent(slugPart)
      } catch {
        sendText(res, 400, 'bad request')
        return
      }
      const gameDir = await resolveGameDir(gamesDir, slug)
      if (gameDir === null) {
        sendText(res, 404, 'not found')
        return
      }
      await serveStatic(`/${tail}`, res, gameDir, head)
      return
    }
    if (path.startsWith('/ruffle/') && options.ruffleDir !== undefined) {
      await serveStatic(path.slice('/ruffle'.length), res, options.ruffleDir, head)
      return
    }
    sendText(res, 404, 'not found')
  }

  return { handler, sync }
}

/**
 * 独立游戏库服务器（测试/调试用；生产由主服务器前缀路由承载）。
 * @param options - 见 {@link GamesRouteOptions}。
 * @param base - 挂载前缀（缺省 ''）。
 * @returns 服务器句柄；close() 关闭全部连接并停止监听。
 */
export async function createGamesServer(options: GamesRouteOptions & { host?: string; port?: number }, base = ''): Promise<GamesServerHandle> {
  const host = options.host ?? '127.0.0.1'
  const gamesDir = join(options.root, GAMES)
  await mkdir(gamesDir, { recursive: true })
  await seedIfNeeded(gamesDir, options.seedDir)

  const router = createGamesRouter(options, base)
  let port = 0
  const server = createServer((req, res) => {
    void router.handler(req, res).catch((error: unknown) => {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('internal error')
      ;(options.log ?? ((m: string) => console.warn(`[7d7d] ${m}`)))(`请求处理失败：${error instanceof Error ? error.message : String(error)}`)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => resolve())
  })
  port = (server.address() as AddressInfo).port

  void router.sync()

  return {
    port,
    url: `http://${host}:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    },
  }
}
