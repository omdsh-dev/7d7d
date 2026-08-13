/**
 * 社区同步单元测试：远程（fake fetcher 模拟 catalog 与文件下载）+ 本地（仓库源目录拷贝）。
 * @module 7d7d/tests/community
 */

import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { syncCommunity, syncCommunityLocal } from '../src/community.ts'

let tempDirs: string[] = []

async function makeGamesDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), '7d7d-community-'))
  tempDirs.push(dir)
  await mkdir(join(dir, 'games'), { recursive: true })
  return join(dir, 'games')
}

async function makeSourceDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), '7d7d-community-src-'))
  tempDirs.push(dir)
  await mkdir(join(dir, 'alpha'), { recursive: true })
  await writeFile(join(dir, 'alpha', 'game.json'), JSON.stringify({ title: 'Alpha 游戏' }))
  await writeFile(join(dir, 'alpha', 'index.html'), '<h1>alpha</h1>')
  // 无 game.json 的目录不是社区游戏。
  await mkdir(join(dir, 'not-a-game'), { recursive: true })
  await writeFile(join(dir, 'not-a-game', 'index.html'), '<h1>x</h1>')
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const CATALOG_URL = 'https://example.test/7d7d/catalog.json'
const CATALOG = {
  updatedAt: '2030-01-15T00:00:00.000Z',
  games: [
    { slug: 'alpha', title: 'Alpha 游戏', files: ['game.json', 'index.html'] },
  ],
}

/** fake fetcher：按 URL 返回 catalog 或游戏文件。 */
function fakeFetcher(overrides: Record<string, unknown> = {}): (url: string) => Promise<Response> {
  const files: Record<string, string> = {
    [`https://example.test/7d7d/community-games/alpha/game.json`]: JSON.stringify({ title: 'Alpha 游戏' }),
    [`https://example.test/7d7d/community-games/alpha/index.html`]: '<h1>alpha</h1>',
    ...overrides,
  }
  return async (url: string) => {
    if (url === CATALOG_URL) return new Response(JSON.stringify(CATALOG), { status: 200 })
    const body = files[url]
    if (body === undefined) return new Response('not found', { status: 404 })
    return new Response(body, { status: 200 })
  }
}

describe('syncCommunity', () => {
  it('downloads missing games atomically into games/community', async () => {
    const gamesDir = await makeGamesDir()
    const logs: string[] = []
    const result = await syncCommunity({ gamesDir, catalogUrl: CATALOG_URL, fetcher: fakeFetcher(), log: (m) => { logs.push(m) } })
    expect(result.synced).toEqual(['alpha'])
    expect(result.skipped).toEqual([])
    expect(result.failed).toEqual([])
    const meta = JSON.parse(await readFile(join(gamesDir, 'community', 'alpha', 'game.json'), 'utf8'))
    expect(meta.title).toBe('Alpha 游戏')
    expect(await readFile(join(gamesDir, 'community', 'alpha', 'index.html'), 'utf8')).toBe('<h1>alpha</h1>')
  })

  it('is idempotent: existing games are skipped', async () => {
    const gamesDir = await makeGamesDir()
    await syncCommunity({ gamesDir, catalogUrl: CATALOG_URL, fetcher: fakeFetcher() })
    const result = await syncCommunity({ gamesDir, catalogUrl: CATALOG_URL, fetcher: fakeFetcher() })
    expect(result.synced).toEqual([])
    expect(result.skipped).toEqual(['alpha'])
  })

  it('leaves no partial game when a file download fails', async () => {
    const gamesDir = await makeGamesDir()
    const logs: string[] = []
    const result = await syncCommunity({
      gamesDir,
      catalogUrl: CATALOG_URL,
      fetcher: fakeFetcher({ 'https://example.test/7d7d/community-games/alpha/index.html': undefined }),
      log: (m) => { logs.push(m) },
    })
    expect(result.synced).toEqual([])
    expect(result.failed).toEqual(['alpha'])
    await expect(access(join(gamesDir, 'community', 'alpha'))).rejects.toThrow()
    expect(logs.some((m) => m.includes('index.html'))).toBe(true)
  })

  it('tolerates a broken catalog without throwing', async () => {
    const gamesDir = await makeGamesDir()
    const result = await syncCommunity({
      gamesDir,
      catalogUrl: CATALOG_URL,
      fetcher: async () => new Response('nope', { status: 500 }),
    })
    expect(result.synced).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('ignores unsafe slugs from the catalog', async () => {
    const gamesDir = await makeGamesDir()
    const evil = {
      updatedAt: 'x',
      games: [
        { slug: '../../evil', title: '坏', files: ['game.json'] },
        { slug: 'a/b', title: '坏2', files: ['game.json'] },
        { slug: 'ok', title: '好', files: ['game.json'] },
      ],
    }
    const result = await syncCommunity({
      gamesDir,
      catalogUrl: CATALOG_URL,
      fetcher: async (url: string) => {
        if (url === CATALOG_URL) return new Response(JSON.stringify(evil), { status: 200 })
        return new Response(JSON.stringify({ title: '好' }), { status: 200 })
      },
    })
    expect(result.synced).toEqual(['ok'])
    await expect(access(join(gamesDir, 'community', '..', 'evil'))).rejects.toThrow()
  })

  it('falls back to the GitHub Contents API when raw is blocked', async () => {
    const gamesDir = await makeGamesDir()
    const rawCatalog = 'https://raw.githubusercontent.com/omdsh-dev/7d7d/main/catalog.json'
    const apiCatalog = 'https://api.github.com/repos/omdsh-dev/7d7d/contents/catalog.json?ref=main'
    const apiGame = 'https://api.github.com/repos/omdsh-dev/7d7d/contents/community-games/alpha/game.json?ref=main'
    const catalog = JSON.stringify({ updatedAt: 'x', games: [{ slug: 'alpha', title: 'A', files: ['game.json', 'index.html'] }] })
    const fetcher = async (url: string): Promise<Response> => {
      if (url === rawCatalog) return new Response('nf', { status: 404 })
      if (url === apiCatalog) {
        return new Response(JSON.stringify({ content: Buffer.from(catalog).toString('base64') }), { status: 200 })
      }
      if (url === apiGame) {
        return new Response(JSON.stringify({ content: Buffer.from(JSON.stringify({ title: 'A' })).toString('base64') }), { status: 200 })
      }
      // 非 raw 域名的文件直连可用（混合路径）。
      if (url.endsWith('alpha/index.html')) return new Response('<h1>alpha</h1>', { status: 200 })
      return new Response('nf', { status: 404 })
    }
    const result = await syncCommunity({ gamesDir, catalogUrl: rawCatalog, fetcher })
    expect(result.synced).toEqual(['alpha'])
    expect(await readFile(join(gamesDir, 'community', 'alpha', 'game.json'), 'utf8')).toBe(JSON.stringify({ title: 'A' }))
    expect(await readFile(join(gamesDir, 'community', 'alpha', 'index.html'), 'utf8')).toBe('<h1>alpha</h1>')
  })
})

describe('syncCommunityLocal', () => {
  it('copies games from the repo source dir into games/community', async () => {
    const gamesDir = await makeGamesDir()
    const result = await syncCommunityLocal({ gamesDir, sourceDir: await makeSourceDir() })
    expect(result.synced).toEqual(['alpha'])
    expect(result.skipped).toEqual([])
    expect(result.failed).toEqual([])
    expect(JSON.parse(await readFile(join(gamesDir, 'community', 'alpha', 'game.json'), 'utf8')).title).toBe('Alpha 游戏')
    expect(await readFile(join(gamesDir, 'community', 'alpha', 'index.html'), 'utf8')).toBe('<h1>alpha</h1>')
    // 无 game.json 的目录不拷贝。
    await expect(access(join(gamesDir, 'community', 'not-a-game'))).rejects.toThrow()
  })

  it('is idempotent: existing games are skipped', async () => {
    const gamesDir = await makeGamesDir()
    const sourceDir = await makeSourceDir()
    await syncCommunityLocal({ gamesDir, sourceDir })
    const result = await syncCommunityLocal({ gamesDir, sourceDir })
    expect(result.synced).toEqual([])
    expect(result.skipped).toEqual(['alpha'])
  })

  it('tolerates a missing source dir', async () => {
    const gamesDir = await makeGamesDir()
    const result = await syncCommunityLocal({ gamesDir, sourceDir: join(await makeGamesDir(), 'nope') })
    expect(result.synced).toEqual([])
    expect(result.failed).toEqual([])
  })
})
