/**
 * 重新生成 catalog.json：扫描 community-games/ 下每个游戏目录，
 * 收集 slug / title / 文件清单。提交社区游戏后运行本脚本并一并提交 catalog.json，
 * 用户的 7d7d 门户在下次同步时即可拉到新游戏。
 * 运行：node scripts/update-catalog.mjs
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const COMMUNITY_DIR = join(ROOT, 'community-games')
const OUT = join(ROOT, 'catalog.json')

/** 递归收集目录下所有文件（相对路径，正斜杠）。 */
async function collectFiles(dir, base = '') {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    const rel = base === '' ? entry.name : `${base}/${entry.name}`
    if (entry.isDirectory()) {
      out.push(...await collectFiles(abs, rel))
    } else {
      out.push(rel)
    }
  }
  return out.sort()
}

const entries = await readdir(COMMUNITY_DIR, { withFileTypes: true })
const games = []
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const dir = join(COMMUNITY_DIR, entry.name)
  const gameJsonPath = join(dir, 'game.json')
  try {
    await stat(gameJsonPath)
  } catch {
    console.warn(`跳过 ${entry.name}：缺少 game.json`)
    continue
  }
  const meta = JSON.parse(await readFile(gameJsonPath, 'utf8'))
  games.push({
    slug: entry.name,
    title: typeof meta.title === 'string' && meta.title !== '' ? meta.title : entry.name,
    files: await collectFiles(dir),
  })
}

games.sort((a, b) => a.slug.localeCompare(b.slug))
const catalog = { games }
await writeFile(OUT, JSON.stringify(catalog, null, 2) + '\n')
console.log(`catalog.json 已更新：${games.length} 个社区游戏`)
for (const game of games) console.log(`  - ${game.slug} (${game.files.length} 个文件)`)
