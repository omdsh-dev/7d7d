#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (!manifest.keywords?.includes('dsh-plugin')) {
  throw new Error('package discovery keyword dsh-plugin is missing')
}

const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  encoding: 'utf8',
  env: { ...process.env, NPM_TOKEN: '' },
})
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const report = JSON.parse(result.stdout)[0]
if (!report || !Array.isArray(report.files)) throw new Error('npm pack returned an unexpected report')
const paths = report.files.map(({ path }) => path)
const forbidden = [
  /^\.npmrc$/,
  /^\.env(?:\.|$)/,
  /^pnpm-lock\.yaml$/,
  /(?:^|\/)node_modules(?:\/|$)/,
  /(?:^|\/)vendor\/ruffle\/runtime-/,
  /\.tgz$/,
]
const leaked = paths.filter((file) => forbidden.some((pattern) => pattern.test(file)))
if (leaked.length > 0) throw new Error(`package contains forbidden local files: ${leaked.join(', ')}`)

console.log(`package tarball verified: ${paths.length} files, ${report.size} bytes`)
