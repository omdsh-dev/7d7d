/**
 * 社区游戏同步：从仓库 catalog.json 拉取社区游戏清单，把本地缺失的游戏
 * 下载到 games/community/<slug>。写入是「先全部拉进内存、再一次性落盘」——
 * 单个游戏任一文件失败则该游戏整体跳过，绝不留下残缺条目。
 * 别人通过 PR 把游戏目录提交到仓库 community-games/（scripts/update-catalog.mjs
 * 重新生成 catalog.json），所有安装了 7d7d 的用户的门户就能同步到它。
 * @module 7d7d/community
 */

import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { COMMUNITY_DIR, GAME_JSON } from './manifest.ts'

/** 社区目录清单里的一行：一个游戏 + 它的文件列表。 */
export interface CommunityCatalogGame {
  slug: string
  title: string
  /** 相对 community-games/<slug>/ 的文件路径列表（必须包含 game.json）。 */
  files: string[]
}

/** 仓库根目录的 catalog.json 结构。 */
export interface CommunityCatalog {
  updatedAt?: string
  games: CommunityCatalogGame[]
}

/** syncCommunity 的入参。 */
export interface CommunitySyncOptions {
  /** 游戏库根目录（其下 games/）。 */
  gamesDir: string
  /** catalog.json 的 URL（通常指向仓库 main 分支）。 */
  catalogUrl: string
  /** 可注入的抓取器（测试用）；缺省全局 fetch。 */
  fetcher?: (url: string) => Promise<Response>
  /** 进度日志（缺省静默）。 */
  log?: (message: string) => void
}

/** 一次同步的结果：按游戏 slug 分组。 */
export interface CommunitySyncResult {
  /** 本次新下载的游戏。 */
  synced: string[]
  /** 本地已存在、跳过的游戏。 */
  skipped: string[]
  /** 下载失败的社区游戏。 */
  failed: string[]
}

/** 社区游戏在仓库里的目录名（URL 路径用；区别于本地落盘的 COMMUNITY_DIR）。 */
const REMOTE_GAMES_DIR = 'community-games'

/** raw.githubusercontent.com URL 的匹配（owner/repo/ref/…路径）。 */
const RAW_GITHUB_RE = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\//

/**
 * 把 raw.githubusercontent.com URL 映射为 GitHub Contents API URL。
 * 受限网络（raw 域名被墙/代理拦截）时用 API 兜底；非 raw URL 返回 null。
 */
function contentsApiUrlOf(rawUrl: string): string | null {
  const match = RAW_GITHUB_RE.exec(rawUrl)
  if (match === null) return null
  const [, owner, repo, ref] = match
  const path = rawUrl.slice(match[0].length)
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`
}

/**
 * 抓取一个社区文件：优先 raw URL，失败时若命中 GitHub raw 模式则回退
 * Contents API（返回 base64 JSON 信封，1MB 限制对单文件小游戏绰绰有余）。
 */
async function fetchCommunityFile(
  fetcher: (url: string) => Promise<Response>,
  url: string,
): Promise<Response> {
  const raw = await fetcher(url)
  if (raw.ok) return raw
  const api = contentsApiUrlOf(url)
  if (api === null) return raw
  const res = await fetcher(api)
  if (!res.ok) return raw
  const data = await res.json() as { content?: unknown }
  if (typeof data.content !== 'string') return raw
  return new Response(Buffer.from(data.content, 'base64'), { status: 200 })
}

/** slug 安全字符检查：拒绝路径穿越与盘符逃逸。 */
function isSafeSlug(slug: string): boolean {
  return slug !== '' && !slug.includes('/') && !slug.includes('\\') && !slug.includes('..')
}

/** 解析并校验 catalog.json；无效行直接丢弃。 */
async function parseCatalog(url: string, fetcher: (url: string) => Promise<Response>): Promise<CommunityCatalog> {
  const res = await fetchCommunityFile(fetcher, url)
  if (!res.ok) throw new Error(`catalog HTTP ${res.status}`)
  const raw = await res.json() as Partial<CommunityCatalog> | null
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.games)) {
    throw new Error('catalog.json 无效：缺少 games[]')
  }
  const games: CommunityCatalogGame[] = []
  for (const game of raw.games) {
    if (game === null || typeof game !== 'object') continue
    const slug = game.slug
    const files = game.files
    if (typeof slug !== 'string' || !isSafeSlug(slug)) continue
    if (!Array.isArray(files)) continue
    const clean: string[] = []
    for (const file of files) {
      if (typeof file === 'string' && file !== '' && !file.includes('..')) clean.push(file)
    }
    if (!clean.includes(GAME_JSON)) continue
    games.push({
      slug,
      title: typeof game.title === 'string' && game.title !== '' ? game.title : slug,
      files: clean,
    })
  }
  return { games }
}

/** catalog.json 所在目录 = 仓库根；游戏文件在 <根>/community-games/<slug>/<file>。 */
function catalogBaseUrl(catalogUrl: string): string {
  return new URL('.', catalogUrl).toString()
}

/**
 * 执行一次社区同步：拉取 catalog → 逐个下载缺失游戏 → 原子落盘。
 * @param options - 见 {@link CommunitySyncOptions}。
 * @returns 同步结果（永不抛错：所有失败都折叠进结果与日志）。
 */
export async function syncCommunity(options: CommunitySyncOptions): Promise<CommunitySyncResult> {
  const fetcher = options.fetcher ?? ((url: string) => fetch(url))
  const log = options.log ?? (() => {})
  const result: CommunitySyncResult = { synced: [], skipped: [], failed: [] }

  let catalog: CommunityCatalog
  try {
    catalog = await parseCatalog(options.catalogUrl, fetcher)
  } catch (error) {
    log(`7d7d 社区目录拉取失败：${error instanceof Error ? error.message : String(error)}`)
    return result
  }

  const base = catalogBaseUrl(options.catalogUrl)
  const communityDir = join(options.gamesDir, COMMUNITY_DIR)
  for (const game of catalog.games) {
    const target = join(communityDir, game.slug)
    // 已存在（含 game.json）即跳过——重跑幂等。
    try {
      await readFile(join(target, GAME_JSON), 'utf8')
      result.skipped.push(game.slug)
      continue
    } catch {
      // 不存在或不可读 → 尝试下载
    }
    // 先全部拉进内存：任一文件失败则整体跳过，不留残缺条目。
    const files: Array<{ name: string; body: Buffer }> = []
    let failed = false
    for (const file of game.files) {
      try {
        const res = await fetchCommunityFile(fetcher, `${base}${REMOTE_GAMES_DIR}/${game.slug}/${file}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        files.push({ name: file, body: Buffer.from(await res.arrayBuffer()) })
      } catch (error) {
        failed = true
        log(`7d7d 社区游戏 ${game.slug} 下载 ${file} 失败：${error instanceof Error ? error.message : String(error)}`)
        break
      }
    }
    if (failed) {
      result.failed.push(game.slug)
      continue
    }
    try {
      await mkdir(target, { recursive: true })
      for (const file of files) await writeFile(join(target, file.name), file.body)
      result.synced.push(game.slug)
    } catch (error) {
      log(`7d7d 社区游戏 ${game.slug} 落盘失败：${error instanceof Error ? error.message : String(error)}`)
      result.failed.push(game.slug)
    }
  }
  return result
}

/** syncCommunityLocal 的入参。 */
export interface CommunityLocalSyncOptions {
  /** 游戏库根目录（其下 games/）。 */
  gamesDir: string
  /** 插件仓库内的社区游戏目录（<仓库>/community-games）。 */
  sourceDir: string
  /** 进度日志（缺省静默）。 */
  log?: (message: string) => void
}

/**
 * 本地社区同步：把插件仓库 community-games/ 里的游戏拷进 games/community/。
 * 零网络、零认证——7d7d 用户按 README 克隆仓库安装，仓库本身就是社区源；
 * `git pull` 拉取更新后，门户同步即拿到新游戏。已存在的游戏跳过（幂等）。
 */
export async function syncCommunityLocal(options: CommunityLocalSyncOptions): Promise<CommunitySyncResult> {
  const log = options.log ?? (() => {})
  const result: CommunitySyncResult = { synced: [], skipped: [], failed: [] }
  let entries
  try {
    entries = await readdir(options.sourceDir, { withFileTypes: true })
  } catch {
    log(`7d7d 社区游戏源目录不存在：${options.sourceDir}`)
    return result
  }
  const communityDir = join(options.gamesDir, COMMUNITY_DIR)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const slug = entry.name
    if (!isSafeSlug(slug)) continue
    const source = join(options.sourceDir, slug)
    const target = join(communityDir, slug)
    // 源必须有 game.json 才视为社区游戏。
    try {
      await readFile(join(source, GAME_JSON), 'utf8')
    } catch {
      continue
    }
    // 目标已存在即跳过——重跑幂等。
    try {
      await readFile(join(target, GAME_JSON), 'utf8')
      result.skipped.push(slug)
      continue
    } catch {
      // 不存在 → 拷贝
    }
    try {
      await cp(source, target, { recursive: true, force: true })
      result.synced.push(slug)
    } catch (error) {
      log(`7d7d 社区游戏 ${slug} 拷贝失败：${error instanceof Error ? error.message : String(error)}`)
      result.failed.push(slug)
    }
  }
  return result
}
