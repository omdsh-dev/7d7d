/**
 * 游戏库清单：扫描 games/ 下每个子目录的 game.json，解析为门户清单。
 * 社区同步的游戏落在 games/community/<slug>（见 community.ts），同样被扫描，
 * 但本地游戏（games/<slug>）slug 相同时优先。
 * 服务端每次请求都重新扫描（游戏库由模型/用户直接写文件，无需注册流程）——
 * 目录规模是百级以内，扫描开销可忽略；这是「写完即上架」的关键设计。
 * @module 7d7d/manifest
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GameMeta, GameSource, GameType, Manifest } from './types.ts'

/** 每个游戏目录内的元数据文件名。 */
export const GAME_JSON = 'game.json'

/** 社区游戏落盘目录（games/ 下）。 */
export const COMMUNITY_DIR = 'community'

const DEFAULT_ENTRY = 'index.html'
const DEFAULT_SWF = 'game.swf'
const DEFAULT_CATEGORY = '未分类'
const DEFAULT_EMOJI = '🎮'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(raw: Record<string, unknown>, key: string, fallback: string): string {
  const value = raw[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function stringArrayField(raw: Record<string, unknown>, key: string): string[] {
  const value = raw[key]
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim() !== '') out.push(item.trim())
  }
  return out
}

/** 解析一份 game.json；字段缺失/类型错误时回退默认值，绝不抛错。 */
export function parseGameJson(slug: string, raw: unknown): GameMeta | null {
  if (!isRecord(raw)) return null
  const typeRaw = raw.type
  const type: GameType = typeRaw === 'flash' ? 'flash' : 'html5'
  const createdAtRaw = raw.createdAt
  return {
    slug,
    title: stringField(raw, 'title', slug),
    description: stringField(raw, 'description', ''),
    category: stringField(raw, 'category', DEFAULT_CATEGORY),
    tags: stringArrayField(raw, 'tags'),
    author: stringField(raw, 'author', ''),
    type,
    source: 'local',
    entry: stringField(raw, 'entry', DEFAULT_ENTRY),
    swf: stringField(raw, 'swf', DEFAULT_SWF),
    cover: typeof raw.cover === 'string' && raw.cover.trim() !== '' ? raw.cover.trim() : null,
    emoji: stringField(raw, 'emoji', DEFAULT_EMOJI),
    createdAt: typeof createdAtRaw === 'number' && Number.isFinite(createdAtRaw) ? createdAtRaw : null,
  }
}

/** 列出目录下的子目录名（目录不存在时返回空数组）。 */
async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 从某个游戏基目录读取一个游戏；目录不存在或 game.json 无效时返回 null。 */
async function readGameFrom(baseDir: string, slug: string, source: GameSource): Promise<GameMeta | null> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(baseDir, slug, GAME_JSON), 'utf8'))
  } catch {
    return null
  }
  const game = parseGameJson(slug, raw)
  return game === null ? null : { ...game, source }
}

/** 读取一个游戏的元数据：本地优先，其次社区目录；都无则 null。 */
export async function readGame(gamesDir: string, slug: string): Promise<GameMeta | null> {
  const local = await readGameFrom(gamesDir, slug, 'local')
  if (local !== null) return local
  return await readGameFrom(join(gamesDir, COMMUNITY_DIR), slug, 'community')
}

/** 扫描整个游戏库（本地 + 社区），产出门户清单。gamesDir 不存在时视为空库。 */
export async function readManifest(gamesDir: string): Promise<Manifest> {
  const games: GameMeta[] = []
  const localSlugs = new Set<string>()
  for (const name of await listDirs(gamesDir)) {
    const game = await readGameFrom(gamesDir, name, 'local')
    if (game !== null) {
      games.push(game)
      localSlugs.add(name)
    }
  }
  // 社区游戏：与本地 slug 冲突时本地优先，社区条目跳过。
  for (const name of await listDirs(join(gamesDir, COMMUNITY_DIR))) {
    if (localSlugs.has(name)) continue
    const game = await readGameFrom(join(gamesDir, COMMUNITY_DIR), name, 'community')
    if (game !== null) games.push(game)
  }
  games.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  const categories = [...new Set(games.map((game) => game.category).filter((c) => c !== ''))].sort((a, b) => a.localeCompare(b, 'zh'))
  return { games, categories }
}
