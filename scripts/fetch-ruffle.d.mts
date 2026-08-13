export const RUFFLE_VERSION: '0.5.0'
export const RUFFLE_TARBALL_URL: string
export const RUFFLE_TARBALL_INTEGRITY: string
export const RUFFLE_RUNTIME_SHA256: Readonly<Record<string, string>>
export const RUFFLE_NOTICE_SHA256: Readonly<Record<string, string>>
export const RUFFLE_RUNTIME_DIR: string

export function verifyRuffleArchive(archive: Uint8Array): Map<string, Buffer>
export function installFilesAtomically(
  files: ReadonlyMap<string, Uint8Array>,
  targetDir: string,
  manifest?: Readonly<Record<string, string>>,
): Promise<'installed' | 'already-installed'>
export function fetchRuffleArchive(fetcher?: typeof fetch): Promise<Buffer>
export function main(): Promise<void>
