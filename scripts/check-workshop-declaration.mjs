#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const plugin = JSON.parse(await readFile(resolve(root, 'dsh.plugin.json'), 'utf8'))
const declaration = manifest.dshWorkshop
const errors = []
const require = (condition, message) => { if (!condition) errors.push(message) }
const exactRc6 = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-host-webserver',
]

require(manifest.version === '0.4.0-rc.2', 'package version must be 0.4.0-rc.2')
require(plugin.version === manifest.version, 'dsh.plugin.json version differs from package.json')
require(plugin.engines?.dsh === '>=0.1.0-rc.6 <0.2.0', 'DSH engine range is not anchored at RC.6')
require(declaration?.schema === 'omdsh-workshop-package/v1', 'Workshop schema is missing')
require(declaration?.type === 'plugin', 'Workshop type must be plugin')
require(declaration?.integration?.protocol === 'harness-profile', 'Workshop protocol must be harness-profile')
require(declaration?.integration?.artifact === 'cordis.patch.yml', 'Workshop artifact must be cordis.patch.yml')
require(declaration?.install?.mode === 'transactional', 'Workshop install mode must be transactional')
require(declaration?.install?.adapter === 'profile-bundle', 'Workshop adapter must be profile-bundle')
require(declaration?.install?.failurePolicy === 'generation-rollback', 'Workshop failure policy must be generation-rollback')
require(declaration?.install?.touchesCurrentBeforeActivation === false, 'Workshop install may not touch current before activation')
require(declaration?.lifecycle?.activation === 'restart-profile', 'Workshop may not claim unverified hot reload')
require(declaration?.capability?.id === '7d7d-routes-registered', 'Workshop capability id is not fixed')
require(declaration?.capability?.kind === 'service', 'Workshop capability kind must be service')
require(declaration?.evidence?.hotReload === null, 'Workshop hot reload evidence must remain null')
for (const name of exactRc6) {
  require(manifest.peerDependencies?.[name] === '0.1.0-rc.6', `${name} peer dependency is not exact RC.6`)
  require(manifest.devDependencies?.[name] === '0.1.0-rc.6', `${name} dev dependency is not exact RC.6`)
}
for (const path of Object.values(declaration?.evidence || {}).filter(Boolean)) {
  try {
    await access(resolve(root, path))
  } catch {
    errors.push(`Workshop evidence path is missing: ${path}`)
  }
}
if (errors.length) throw new Error(errors.join('\n'))

console.log('Workshop declaration accepted: transactional Profile Bundle intent on RC.6; hot reload unclaimed; verification not granted')
