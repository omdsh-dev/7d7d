/**
 * Download and atomically install a pinned self-hosted Ruffle runtime.
 *
 * The npm tarball is authenticated with its registry SRI before it is parsed.
 * Every installed runtime file is then checked against a reviewed SHA-256
 * manifest. Nothing is written below vendor/ until all archive checks pass.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

export const RUFFLE_VERSION = '0.5.0'
export const RUFFLE_TARBALL_URL =
  'https://registry.npmjs.org/@ruffle-rs/ruffle/-/ruffle-0.5.0.tgz'
export const RUFFLE_TARBALL_INTEGRITY =
  'sha512-BBlfXsOkUXtB1wMUC5y27v6SRdDsuVYdPzGq80MzmF1QWryHkWYZh4I7I22uura07TFNzBeb5RKsyjct3JTjLA=='

/** Reviewed runtime files required by ruffle.js. */
export const RUFFLE_RUNTIME_SHA256 = Object.freeze({
  'ruffle.js': 'cf068d5b4a42d0179f0a577ccee557e1b3b6419b17565743b220ca350bfc2a45',
  'core.ruffle.15317142e75ce021ac04.js': 'a4592038591c6dde268e25b84febb1a11be753d7560ee9ff5ae7872b74cf67e8',
  'core.ruffle.5e30dc5777a75720eae2.js': '7b1950264b756723aee00a87460cea09e8d91ccd5545c6d1a04d35fc5fd74118',
  '6ce4f603a1fe7cc88438.wasm': '8bfd80fdf324ee23ecb0c2db724c815744c29efddc5cf62922ad06aa34eaf17e',
  'a71cef02d58dcec6f55f.wasm': 'd5e88aa186b80651cb110d4609822cee491d562f3a6310a866dd4c639e58fe67',
})

/** Upstream license notices installed beside the runtime. */
export const RUFFLE_NOTICE_SHA256 = Object.freeze({
  LICENSE_APACHE: '62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a',
  LICENSE_MIT: '4de9338a7879c68e911742a7d691f0797ff1ef8d8a6fb978b0c711e258fe959c',
})

const INSTALL_SHA256 = Object.freeze({ ...RUFFLE_RUNTIME_SHA256, ...RUFFLE_NOTICE_SHA256 })
const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const RUFFLE_RUNTIME_DIR = join(ROOT, 'vendor', 'ruffle', `runtime-${RUFFLE_VERSION}`)
const MAX_TARBALL_BYTES = 16 * 1024 * 1024
const MAX_UNPACKED_BYTES = 40 * 1024 * 1024
const TAR_BLOCK_BYTES = 512

function encodedDigest(body, algorithm, encoding) {
  return createHash(algorithm).update(body).digest(encoding)
}

function assertEncodedDigest(body, algorithm, encoding, expected, label) {
  const actual = Buffer.from(encodedDigest(body, algorithm, encoding), encoding)
  const wanted = Buffer.from(expected, encoding)
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new Error(`${label} digest mismatch`)
  }
}

function assertSha256(body, expected, label) {
  assertEncodedDigest(body, 'sha256', 'hex', expected, label)
}

function readTarText(header, offset, length) {
  const field = header.subarray(offset, offset + length)
  const nul = field.indexOf(0)
  return field.subarray(0, nul === -1 ? field.length : nul).toString('utf8')
}

function readTarOctal(header, offset, length, label) {
  const text = readTarText(header, offset, length).trim()
  if (!/^[0-7]+$/.test(text)) throw new Error(`invalid tar ${label}`)
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid tar ${label}`)
  return value
}

function assertTarHeaderChecksum(header) {
  const expected = readTarOctal(header, 148, 8, 'checksum')
  let actual = 0
  for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  if (actual !== expected) throw new Error('tar header checksum mismatch')
}

function isZeroBlock(block) {
  return block.every((byte) => byte === 0)
}

/** Authenticate the npm tarball and return the seven reviewed install files. */
export function verifyRuffleArchive(archive) {
  if (!Buffer.isBuffer(archive)) archive = Buffer.from(archive)
  const [algorithm, expected] = RUFFLE_TARBALL_INTEGRITY.split('-', 2)
  if (algorithm !== 'sha512' || expected === undefined) throw new Error('invalid pinned tarball integrity')
  assertEncodedDigest(archive, algorithm, 'base64', expected, 'Ruffle npm tarball')

  const tar = gunzipSync(archive, { maxOutputLength: MAX_UNPACKED_BYTES })
  const wantedPaths = new Map(
    Object.entries(INSTALL_SHA256).map(([name, digest]) => [`package/${name}`, { name, digest }]),
  )
  const files = new Map()

  for (let offset = 0; offset + TAR_BLOCK_BYTES <= tar.length;) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES)
    if (isZeroBlock(header)) break
    assertTarHeaderChecksum(header)

    const name = readTarText(header, 0, 100)
    const prefix = readTarText(header, 345, 155)
    const archivePath = prefix === '' ? name : `${prefix}/${name}`
    const size = readTarOctal(header, 124, 12, 'size')
    const type = header[156]
    const bodyStart = offset + TAR_BLOCK_BYTES
    const bodyEnd = bodyStart + size
    if (bodyEnd > tar.length) throw new Error(`truncated tar entry: ${archivePath}`)

    const wanted = wantedPaths.get(archivePath)
    if (wanted !== undefined) {
      if (type !== 0 && type !== 0x30) throw new Error(`Ruffle entry is not a regular file: ${archivePath}`)
      if (files.has(wanted.name)) throw new Error(`duplicate Ruffle entry: ${archivePath}`)
      const body = Buffer.from(tar.subarray(bodyStart, bodyEnd))
      assertSha256(body, wanted.digest, archivePath)
      files.set(wanted.name, body)
    }

    offset = bodyStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
  }

  for (const name of Object.keys(INSTALL_SHA256)) {
    if (!files.has(name)) throw new Error(`Ruffle npm tarball is missing package/${name}`)
  }
  return files
}

async function writeExclusive(file, body) {
  const handle = await open(file, 'wx', 0o644)
  try {
    await handle.writeFile(body)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function exists(file) {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function verifyInstalledDirectory(targetDir, manifest) {
  const target = await lstat(targetDir)
  if (!target.isDirectory() || target.isSymbolicLink()) {
    throw new Error(`Ruffle install target is not a regular directory: ${targetDir}`)
  }
  const expectedNames = Object.keys(manifest).sort()
  const entries = await readdir(targetDir, { withFileTypes: true })
  const actualNames = entries.map((entry) => entry.name).sort()
  if (actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error(`existing Ruffle directory has unexpected files: ${targetDir}`)
  }
  for (const entry of entries) {
    if (!entry.isFile()) throw new Error(`existing Ruffle entry is not a regular file: ${entry.name}`)
    assertSha256(await readFile(join(targetDir, entry.name)), manifest[entry.name], entry.name)
  }
}

/**
 * Install a verified file set into a versioned immutable directory.
 * The final rename is an atomic same-filesystem operation. An existing valid
 * directory is a no-op; an existing mismatch is left untouched and rejected.
 */
export async function installFilesAtomically(files, targetDir, manifest = INSTALL_SHA256) {
  const expectedNames = Object.keys(manifest).sort()
  const suppliedNames = [...files.keys()].sort()
  if (suppliedNames.length !== expectedNames.length
    || suppliedNames.some((name, index) => name !== expectedNames[index])) {
    throw new Error('verified Ruffle file set does not match the install manifest')
  }
  for (const name of expectedNames) assertSha256(files.get(name), manifest[name], name)

  if (await exists(targetDir)) {
    await verifyInstalledDirectory(targetDir, manifest)
    return 'already-installed'
  }

  const parent = dirname(targetDir)
  await mkdir(parent, { recursive: true })
  const stagingDir = await mkdtemp(join(parent, `.${RUFFLE_VERSION}-install-`))
  let moved = false
  try {
    for (const name of expectedNames) await writeExclusive(join(stagingDir, name), files.get(name))
    await verifyInstalledDirectory(stagingDir, manifest)
    try {
      await rename(stagingDir, targetDir)
      moved = true
      return 'installed'
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error
      await verifyInstalledDirectory(targetDir, manifest)
      return 'already-installed'
    }
  } finally {
    if (!moved) await rm(stagingDir, { recursive: true, force: true })
  }
}

async function readLimitedResponse(response) {
  if (response.body === null) throw new Error('Ruffle download returned an empty body')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_TARBALL_BYTES) {
      await reader.cancel()
      throw new Error('Ruffle tarball exceeds the pinned size limit')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

export async function fetchRuffleArchive(fetcher = fetch) {
  const response = await fetcher(RUFFLE_TARBALL_URL, {
    headers: { accept: 'application/octet-stream' },
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`Ruffle download failed: HTTP ${response.status}`)
  return await readLimitedResponse(response)
}

export async function main() {
  const downloadDir = await mkdtemp(join(tmpdir(), '7d7d-ruffle-'))
  try {
    const archiveFile = join(downloadDir, `ruffle-${RUFFLE_VERSION}.tgz`)
    await writeExclusive(archiveFile, await fetchRuffleArchive())
    const files = verifyRuffleArchive(await readFile(archiveFile))
    const result = await installFilesAtomically(files, RUFFLE_RUNTIME_DIR)
    console.log(`Ruffle ${RUFFLE_VERSION} ${result}: ${RUFFLE_RUNTIME_DIR}`)
  } finally {
    await rm(downloadDir, { recursive: true, force: true })
  }
}

const invoked = process.argv[1] === undefined ? undefined : realpathSync(process.argv[1])
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
