/**
 * manifest 扫描与 game.json 解析的单元测试。
 * @module 7d7d/tests/manifest
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readGame, readManifest } from '../src/manifest.ts'

let tempDirs: string[] = []

async function makeTemp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), '7d7d-manifest-'))
  tempDirs.push(dir)
  return dir
}

async function writeGame(root: string, slug: string, gameJson: unknown): Promise<void> {
  const dir = join(root, slug)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'game.json'), JSON.stringify(gameJson))
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

describe('parseGameJson', () => {
  it('fills defaults for missing fields', async () => {
    const root = await makeTemp()
    await writeGame(root, 'my-game', { title: '我的游戏' })
    const game = await readGame(root, 'my-game')
    expect(game).not.toBeNull()
    expect(game?.slug).toBe('my-game')
    expect(game?.title).toBe('我的游戏')
    expect(game?.type).toBe('html5')
    expect(game?.entry).toBe('index.html')
    expect(game?.swf).toBe('game.swf')
    expect(game?.category).toBe('未分类')
    expect(game?.cover).toBeNull()
    expect(game?.emoji).toBe('🎮')
  })

  it('parses flash games with custom swf path', async () => {
    const root = await makeTemp()
    await writeGame(root, 'flashy', { title: 'Flash 游戏', type: 'flash', swf: 'assets/main.swf' })
    const game = await readGame(root, 'flashy')
    expect(game?.type).toBe('flash')
    expect(game?.swf).toBe('assets/main.swf')
  })

  it('tolerates invalid json and returns null', async () => {
    const root = await makeTemp()
    const dir = join(root, 'broken')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'game.json'), 'not json {')
    expect(await readGame(root, 'broken')).toBeNull()
  })

  it('treats non-flash type values as html5', async () => {
    const root = await makeTemp()
    await writeGame(root, 'weird', { title: '怪', type: 'unity' })
    expect((await readGame(root, 'weird'))?.type).toBe('html5')
  })
})

describe('readManifest', () => {
  it('scans games and derives sorted categories', async () => {
    const root = await makeTemp()
    await writeGame(root, 'b-game', { title: 'B 游戏', category: '动作' })
    await writeGame(root, 'a-game', { title: 'A 游戏', category: '休闲' })
    await writeGame(root, 'c-game', { title: 'C 游戏', category: '动作' })
    const manifest = await readManifest(root)
    expect(manifest.games.map((g) => g.slug)).toEqual(['a-game', 'b-game', 'c-game'])
    expect(manifest.categories).toEqual(['动作', '休闲'])
  })

  it('skips files and invalid entries', async () => {
    const root = await makeTemp()
    await writeGame(root, 'good', { title: '好游戏' })
    await writeFile(join(root, 'not-a-game.json'), '{}')
    const manifest = await readManifest(root)
    expect(manifest.games).toHaveLength(1)
    expect(manifest.games[0]?.slug).toBe('good')
  })

  it('returns an empty manifest for a missing directory', async () => {
    const manifest = await readManifest(join(await makeTemp(), 'nope'))
    expect(manifest.games).toEqual([])
    expect(manifest.categories).toEqual([])
  })

  it('includes community games with source=community', async () => {
    const root = await makeTemp()
    await mkdir(join(root, 'community', 'c1'), { recursive: true })
    await writeFile(join(root, 'community', 'c1', 'game.json'), JSON.stringify({ title: '社区一', category: '动作' }))
    await writeGame(root, 'local-one', { title: '本地一', category: '休闲' })
    const manifest = await readManifest(root)
    const game = manifest.games.find((g) => g.slug === 'c1')
    expect(game).toBeDefined()
    expect(game?.source).toBe('community')
    expect(game?.title).toBe('社区一')
    expect(manifest.categories).toEqual(['动作', '休闲'])
  })

  it('lets local games win on slug collision with community', async () => {
    const root = await makeTemp()
    await writeGame(root, 'same', { title: '本地版' })
    await mkdir(join(root, 'community', 'same'), { recursive: true })
    await writeFile(join(root, 'community', 'same', 'game.json'), JSON.stringify({ title: '社区版' }))
    const manifest = await readManifest(root)
    expect(manifest.games).toHaveLength(1)
    expect(manifest.games[0]?.title).toBe('本地版')
    expect(manifest.games[0]?.source).toBe('local')
  })

  it('readGame resolves community games after local miss', async () => {
    const root = await makeTemp()
    await mkdir(join(root, 'community', 'c2'), { recursive: true })
    await writeFile(join(root, 'community', 'c2', 'game.json'), JSON.stringify({ title: '社区二', type: 'flash' }))
    const game = await readGame(root, 'c2')
    expect(game?.source).toBe('community')
    expect(game?.type).toBe('flash')
  })
})
