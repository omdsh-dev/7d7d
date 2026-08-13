/**
 * 游戏库服务器集成测试：真实监听端口上的清单、静态资源、播放页与安全行为。
 * @module 7d7d/tests/server
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGamesServer } from '../src/server.ts'

let tempDirs: string[] = []
const servers: Array<{ close(): Promise<void> }> = []

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), '7d7d-server-'))
  tempDirs.push(dir)
  const games = join(dir, 'games')
  await mkdir(join(games, 'demo'), { recursive: true })
  await writeFile(join(games, 'demo', 'game.json'), JSON.stringify({ title: '演示', category: '演示类', emoji: '🕹️' }))
  await writeFile(join(games, 'demo', 'index.html'), '<h1>demo</h1>')
  return dir
}

async function boot(root?: string, extra: Record<string, unknown> = {}, base = ''): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await createGamesServer({ root: root ?? await makeRoot(), host: '127.0.0.1', ...extra }, base)
  servers.push(handle)
  return handle
}

async function get(url: string): Promise<{ status: number; text: string; type: string; cors: string | null }> {
  const res = await fetch(url)
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') ?? '', cors: res.headers.get('access-control-allow-origin') }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('games server', () => {
  it('serves a live manifest with categories', async () => {
    const { url } = await boot()
    const { status, text, type } = await get(`${url}/api/manifest.json`)
    expect(status).toBe(200)
    expect(type).toContain('application/json')
    const manifest = JSON.parse(text)
    expect(manifest.games).toHaveLength(1)
    expect(manifest.games[0].slug).toBe('demo')
    expect(manifest.categories).toEqual(['演示类'])
  })

  it('serves game static files with directory index', async () => {
    const { url } = await boot()
    const direct = await get(`${url}/g/demo/index.html`)
    expect(direct.status).toBe(200)
    expect(direct.text).toBe('<h1>demo</h1>')
    const viaDir = await get(`${url}/g/demo`)
    expect(viaDir.status).toBe(200)
    expect(viaDir.text).toBe('<h1>demo</h1>')
  })

  it('rejects traversal from the game mount', async () => {
    const { url } = await boot()
    // 越界在 slug 层就被拒（404，不泄露存在性）；static.ts 层另有 403 防护（见 static.spec）。
    const res = await get(`${url}/g/..%2f..%2fetc%2fpasswd`)
    expect(res.status).toBe(404)
    expect((await get(`${url}/g/../plain.txt`)).status).toBe(404)
  })

  it('404s for unknown games and paths', async () => {
    const { url } = await boot()
    expect((await get(`${url}/g/ghost`)).status).toBe(404)
    expect((await get(`${url}/nope`)).status).toBe(404)
  })

  it('405s non-GET methods', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/manifest.json`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('serves the flash player page for flash games', async () => {
    const dir = await makeRoot()
    const games = join(dir, 'games')
    await mkdir(join(games, 'flashy'), { recursive: true })
    await writeFile(join(games, 'flashy', 'game.json'), JSON.stringify({ title: '闪光', type: 'flash' }))
    const { url } = await boot(dir)
    const { status, text, type } = await get(`${url}/player/flashy`)
    expect(status).toBe(200)
    expect(type).toContain('text/html')
    expect(text).toContain('Ruffle')
    expect(text).toContain('/g/flashy/game.swf')
    expect(text).toContain("s.src = \"/ruffle/ruffle.js\"")
    expect(text).toContain('pnpm fetch:ruffle')
    expect(text).not.toContain('unpkg.com')
  })

  it('404s the player page for html5 games', async () => {
    const { url } = await boot()
    expect((await get(`${url}/player/demo`)).status).toBe(404)
  })

  it('uses the mounted prefix for the self-hosted Ruffle script', async () => {
    const dir = await makeRoot()
    const games = join(dir, 'games')
    await mkdir(join(games, 'flashy'), { recursive: true })
    await writeFile(join(games, 'flashy', 'game.json'), JSON.stringify({ title: '闪光', type: 'flash' }))
    const { url } = await boot(dir, {}, '/7d7d')
    const page = await get(`${url}/7d7d/player/flashy`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('s.src = \"/7d7d/ruffle/ruffle.js\"')
    expect(page.text).not.toContain('unpkg.com')
  })

  it('serves community games from /g/ and lists them in the manifest', async () => {
    const dir = await makeRoot()
    const games = join(dir, 'games')
    await mkdir(join(games, 'community', 'shared'), { recursive: true })
    await writeFile(join(games, 'community', 'shared', 'game.json'), JSON.stringify({ title: '共享游戏', category: '社区类' }))
    await writeFile(join(games, 'community', 'shared', 'index.html'), '<h1>shared</h1>')
    const { url } = await boot(dir)
    const manifest = JSON.parse((await get(`${url}/api/manifest.json`)).text)
    const game = manifest.games.find((g: { slug: string }) => g.slug === 'shared')
    expect(game?.source).toBe('community')
    expect(manifest.categories).toContain('社区类')
    expect((await get(`${url}/g/shared/index.html`)).text).toBe('<h1>shared</h1>')
  })

  it('resolves /api/sync with a community catalog and lands games locally', async () => {
    const dir = await makeRoot()
    const catalogUrl = 'https://example.test/7d7d/catalog.json'
    const files: Record<string, string> = {
      'https://example.test/7d7d/community-games/cg/game.json': JSON.stringify({ title: '同步游戏', category: '同步类' }),
      'https://example.test/7d7d/community-games/cg/index.html': '<h1>cg</h1>',
    }
    const fetcher = async (url: string): Promise<Response> => {
      if (url === catalogUrl) {
        return new Response(JSON.stringify({ updatedAt: 'x', games: [{ slug: 'cg', title: '同步游戏', files: ['game.json', 'index.html'] }] }), { status: 200 })
      }
      const body = files[url]
      return body === undefined ? new Response('not found', { status: 404 }) : new Response(body, { status: 200 })
    }
    const { url } = await boot(dir, { communityCatalogUrl: catalogUrl, fetcher })
    // 手动触发（启动自动同步可能已跑，结果可能是 synced 或 skipped，二选一即可）。
    const res = await fetch(`${url}/api/sync`, { method: 'POST' })
    expect(res.status).toBe(200)
    const result = await res.json() as { synced: string[]; skipped: string[] }
    expect([...result.synced, ...result.skipped]).toContain('cg')
    // 游戏已落盘并出现在门户清单里。
    const manifest = JSON.parse((await get(`${url}/api/manifest.json`)).text)
    expect(manifest.games.some((g: { slug: string; source: string }) => g.slug === 'cg' && g.source === 'community')).toBe(true)
    expect((await get(`${url}/g/cg/index.html`)).text).toBe('<h1>cg</h1>')
    // 同步路由对 GET 回 405。
    expect((await get(`${url}/api/sync`)).status).toBe(405)
  })

  it('syncs community games from the plugin repo source dir', async () => {
    const dir = await makeRoot()
    const sourceDir = await mkdtemp(join(tmpdir(), '7d7d-server-src-'))
    tempDirs.push(sourceDir)
    await mkdir(join(sourceDir, 'repo-game'), { recursive: true })
    await writeFile(join(sourceDir, 'repo-game', 'game.json'), JSON.stringify({ title: '仓库游戏', category: '仓库类' }))
    await writeFile(join(sourceDir, 'repo-game', 'index.html'), '<h1>repo</h1>')
    const { url } = await boot(dir, { communitySourceDir: sourceDir })
    // 启动自动同步可能已跑；手动触发一次保证确定性。
    const res = await fetch(`${url}/api/sync`, { method: 'POST' })
    expect(res.status).toBe(200)
    const result = await res.json() as { synced: string[]; skipped: string[]; failed: string[] }
    expect([...result.synced, ...result.skipped]).toContain('repo-game')
    const manifest = JSON.parse((await get(`${url}/api/manifest.json`)).text)
    const game = manifest.games.find((g: { slug: string }) => g.slug === 'repo-game')
    expect(game?.source).toBe('community')
    expect((await get(`${url}/g/repo-game/index.html`)).text).toBe('<h1>repo</h1>')
  })

  it('mounts under a prefix for same-origin serving (main-server mode)', async () => {
    const { url } = await boot(undefined, {}, '/7d7d')
    // 前缀内的路径全部可用。
    const manifest = JSON.parse((await get(`${url}/7d7d/api/manifest.json`)).text)
    expect(manifest.games[0].slug).toBe('demo')
    expect((await get(`${url}/7d7d/g/demo/index.html`)).text).toBe('<h1>demo</h1>')
    // 前缀外不响应（留给其他路由/SPA fallback）。
    expect((await get(`${url}/api/manifest.json`)).status).toBe(404)
    // 同步 POST 也走前缀。
    const res = await fetch(`${url}/7d7d/api/sync`, { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('answers CORS and OPTIONS preflight for sandboxed game iframes', async () => {
    const { url } = await boot()
    const manifest = await get(`${url}/api/manifest.json`)
    expect(manifest.cors).toBe('*')
    const preflight = await fetch(`${url}/api/sync`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')
  })
})
