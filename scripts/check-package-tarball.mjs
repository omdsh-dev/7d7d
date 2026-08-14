#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (!manifest.keywords?.includes('dsh-plugin')) {
  throw new Error('package discovery keyword dsh-plugin is missing')
}
const lifecycleScripts = ['preinstall', 'install', 'postinstall', 'prepare'].filter((name) => manifest.scripts?.[name])
if (lifecycleScripts.length > 0) {
  throw new Error(`package lifecycle scripts are forbidden: ${lifecycleScripts.join(', ')}`)
}

const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  encoding: 'utf8',
  env: {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? 'C.UTF-8',
    NPM_CONFIG_USERCONFIG: '/dev/null',
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
  },
})
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const report = JSON.parse(result.stdout)[0]
if (!report || !Array.isArray(report.files)) throw new Error('npm pack returned an unexpected report')
const paths = report.files.map(({ path }) => path)
const required = ['package.json', 'cordis.patch.yml', 'docs/WORKSHOP.md', 'lib/index.js', 'lib/client.js']
const missing = required.filter((file) => !paths.includes(file))
if (missing.length > 0) throw new Error(`package is missing required public files: ${missing.join(', ')}`)
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
