import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import { apply, HARNESS_CAPABILITY, MOUNT_BASE, SERVER_INFO_PATH } from '../src/index.ts'

const temporaryRoots: string[] = []
const previousProbe = process.env.OMDSH_HARNESS_PROBE_DIR

afterEach(async () => {
  if (previousProbe === undefined) delete process.env.OMDSH_HARNESS_PROBE_DIR
  else process.env.OMDSH_HARNESS_PROBE_DIR = previousProbe
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Workshop lifecycle probe', () => {
  it('observes route registration and disposal without changing production behavior', async () => {
    const probe = await mkdtemp(join(tmpdir(), '7d7d-workshop-probe-'))
    const library = await mkdtemp(join(tmpdir(), '7d7d-workshop-library-'))
    temporaryRoots.push(probe, library)
    process.env.OMDSH_HARNESS_PROBE_DIR = probe

    const routes: string[] = []
    let disposed = 0
    let cleanup: undefined | (() => void)
    const context = {
      webServer: {
        register(route: { path: string }) {
          routes.push(route.path)
          return () => { disposed += 1 }
        },
      },
      effect(callback: () => void | (() => void)) {
        cleanup = callback() || undefined
      },
      logger: { info() {} },
    } as unknown as Context

    apply(context, { root: library, seed: false, syncCommunity: false })
    expect(routes).toEqual([MOUNT_BASE, SERVER_INFO_PATH])
    const ready = JSON.parse(await readFile(join(probe, 'ready.json'), 'utf8'))
    expect(ready).toMatchObject({
      capability: HARNESS_CAPABILITY,
      version: '0.4.0-rc.2',
      routes: [MOUNT_BASE, SERVER_INFO_PATH],
    })

    expect(cleanup).toBeTypeOf('function')
    cleanup?.()
    expect(disposed).toBe(2)
    const stopped = JSON.parse(await readFile(join(probe, 'disposed.json'), 'utf8'))
    expect(stopped).toMatchObject({ capability: HARNESS_CAPABILITY, version: '0.4.0-rc.2' })
  })
})
