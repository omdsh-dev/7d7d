/**
 * 静态文件服务的单元测试：默认入口、MIME、越界与坏转义防护。
 * @module 7d7d/tests/static
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ServerResponse } from 'node:http'
import { serveStatic } from '../src/static.ts'

let tempDirs: string[] = []

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), '7d7d-static-'))
  tempDirs.push(dir)
  await mkdir(join(dir, 'game1'), { recursive: true })
  await writeFile(join(dir, 'game1', 'index.html'), '<h1>game1</h1>')
  await writeFile(join(dir, 'game1', 'main.js'), 'console.log(1)')
  await writeFile(join(dir, 'plain.txt'), 'hello')
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

/** 捕获响应的最小 ServerResponse 替身。 */
function capture(): { res: ServerResponse; status: number; headers: Record<string, string>; body: string } {
  const state = { status: 200, headers: {} as Record<string, string>, body: '' }
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      state.status = status
      state.headers = headers ?? {}
      return res
    },
    end(body?: string | Buffer) {
      if (body !== undefined) {
        state.body = typeof body === 'string' ? body : body.toString('utf8')
      }
      return res
    },
  } as unknown as ServerResponse
  return {
    res,
    get status() { return state.status },
    get headers() { return state.headers },
    get body() { return state.body },
  }
}

describe('serveStatic', () => {
  it('serves a file with the right mime', async () => {
    const root = await makeRoot()
    const c = capture()
    const hit = await serveStatic('/game1/main.js', c.res, root)
    expect(hit).toBe(true)
    expect(c.status).toBe(200)
    expect(c.headers['content-type']).toMatch(/^text\/javascript/)
    expect(c.body).toBe('console.log(1)')
  })

  it('serves index.html for a directory path', async () => {
    const root = await makeRoot()
    const c = capture()
    await serveStatic('/game1', c.res, root)
    expect(c.status).toBe(200)
    expect(c.body).toBe('<h1>game1</h1>')
  })

  it('404s on a missing file', async () => {
    const root = await makeRoot()
    const c = capture()
    await serveStatic('/game1/nope.js', c.res, root)
    expect(c.status).toBe(404)
  })

  it('rejects path traversal with 403', async () => {
    const root = await makeRoot()
    const c = capture()
    await serveStatic('/game1/../../plain.txt', c.res, root)
    expect(c.status).toBe(403)
  })

  it('rejects encoded traversal with 403', async () => {
    const root = await makeRoot()
    const c = capture()
    await serveStatic('/game1/%2e%2e/%2e%2e/plain.txt', c.res, root)
    expect(c.status).toBe(403)
  })

  it('answers 400 on malformed escapes', async () => {
    const root = await makeRoot()
    const c = capture()
    await serveStatic('/game1/%zz', c.res, root)
    expect(c.status).toBe(400)
  })

  it('treats unknown extensions as octet-stream', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'blob.xyz'), 'x')
    const c = capture()
    await serveStatic('/blob.xyz', c.res, root)
    expect(c.headers['content-type']).toBe('application/octet-stream')
  })
})
