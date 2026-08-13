import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RUFFLE_RUNTIME_SHA256,
  RUFFLE_TARBALL_INTEGRITY,
  RUFFLE_TARBALL_URL,
  RUFFLE_VERSION,
  installFilesAtomically,
  verifyRuffleArchive,
} from '../scripts/fetch-ruffle.mjs'

function sha256(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

describe('Ruffle installer', () => {
  it('pins the reviewed stable npm artifact and five runtime files', () => {
    expect(RUFFLE_VERSION).toBe('0.5.0')
    expect(RUFFLE_TARBALL_URL).toBe(
      'https://registry.npmjs.org/@ruffle-rs/ruffle/-/ruffle-0.5.0.tgz',
    )
    expect(RUFFLE_TARBALL_INTEGRITY).toBe(
      'sha512-BBlfXsOkUXtB1wMUC5y27v6SRdDsuVYdPzGq80MzmF1QWryHkWYZh4I7I22uura07TFNzBeb5RKsyjct3JTjLA==',
    )
    expect(Object.keys(RUFFLE_RUNTIME_SHA256)).toHaveLength(5)
  })

  it('rejects a modified archive before extraction', () => {
    expect(() => verifyRuffleArchive(Buffer.from('not the pinned npm tarball')))
      .toThrow('Ruffle npm tarball digest mismatch')
  })

  it('installs a verified set atomically and refuses to overwrite a mismatch', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), '7d7d-ruffle-test-'))
    const target = join(fixtureRoot, 'runtime-fixture')
    const files = new Map<string, Buffer>([
      ['core.js', Buffer.from('reviewed core')],
      ['runtime.wasm', Buffer.from('reviewed wasm')],
    ])
    const manifest = Object.fromEntries(
      [...files].map(([name, body]) => [name, sha256(body)]),
    )
    try {
      await expect(installFilesAtomically(files, target, manifest)).resolves.toBe('installed')
      await expect(installFilesAtomically(files, target, manifest)).resolves.toBe('already-installed')
      expect((await readdir(target)).sort()).toEqual(['core.js', 'runtime.wasm'])

      await writeFile(join(target, 'core.js'), 'modified after installation')
      await expect(installFilesAtomically(files, target, manifest)).rejects.toThrow('digest mismatch')
      expect(await readFile(join(target, 'core.js'), 'utf8')).toBe('modified after installation')
      expect((await readdir(fixtureRoot)).filter((name) => name.startsWith('.'))).toEqual([])
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('refuses a pre-existing symlink install target', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), '7d7d-ruffle-link-test-'))
    const realTarget = join(fixtureRoot, 'real')
    const linkTarget = join(fixtureRoot, 'runtime-fixture')
    const body = Buffer.from('reviewed core')
    const files = new Map<string, Buffer>([['core.js', body]])
    const manifest = { 'core.js': sha256(body) }
    try {
      await symlink(realTarget, linkTarget, 'dir')
      await expect(installFilesAtomically(files, linkTarget, manifest))
        .rejects.toThrow('not a regular directory')
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})
