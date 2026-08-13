/**
 * 7d7d 双端打包配置 —— 自包含 tsdown preset：
 *  - lib/index.js   —— node 半端：游戏库服务器与主服务器同源路由
 *  - lib/client.js  —— 浏览器半端：closure factory 交给 window.__ModuleLoader__.load，
 *                      平台模块（react 等）走 loader 冻结模块表，其余全部内联；
 *                      .css 经 lightningcss 内联为自动注入的 <style data-plugin-css>。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** DSH Web shell 共享进冻结模块表的平台模块。 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
] as const

/** 客户端 externals：仅平台种子。 */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

/** Host-provided peer packages: never copy them into the published plugin bundle. */
const HOST_EXTERNALS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/schemastery',
] as const

/** 打包纯度门：平台种子保持 external，其余全部内联。 */
function isExternal(source: string): boolean {
  return CLIENT_EXTERNALS.includes(source)
}

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const cssFiles = new Map<string, string>()
const require = createRequire(import.meta.url)

const PLUGIN_ID = '@mattheliu/7d7d'

/** 把 css import 解析为物理文件：包说明符走本仓库 node_modules，相对路径相对 importer。 */
function resolveCssFile(source: string, importer: string | undefined): string {
  if (source.startsWith('.')) {
    if (importer === undefined) throw new Error(`cannot resolve relative css "${source}" without an importer`)
    return resolvePath(dirname(importer), source)
  }
  return require.resolve(source)
}

/** 为一份 css 资源生成 factory 执行期的 <style> 注入模块（无默认导出——调用方自行追加）。 */
function styleTagModule(fileId: string, css: string, tagId: string): string {
  return [
    `const css = ${JSON.stringify(css)};`,
    `if (typeof document !== 'undefined' && document.querySelector(${JSON.stringify(`style[data-plugin-css="${tagId}"]`)}) === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
    `  tag.dataset.pluginCss = ${JSON.stringify(tagId)};`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
  ].join('\n')
}

export default [
  {
    // node 半端：host loader 引入 lib/index.js。
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
    deps: {
      neverBundle: [...HOST_EXTERNALS],
    },
  },
  {
    // 浏览器半端：lib/client.js，由 harness 以 /plugins/<id>/client.js 提供。
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: (id: string) => { return isExternal(id) ? undefined : true },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      // 打包纯度门：任何非平台模块的 @deepseek-ai 值导入都是构建错误——
      // 跨插件协作走 cordis 服务（纯类型导入会被擦除，到不了这门）。
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (isExternal(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (loader module table) — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services',
        )
      },
    }, {
      name: 'dsh-css-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.css')) return null
        const abs = resolveCssFile(source, importer)
        const digest = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 12)
        const virtualId = `${CSS_VIRTUAL_PREFIX}${basename(abs)}-${digest}${CSS_VIRTUAL_SUFFIX}`
        cssFiles.set(virtualId, abs)
        return virtualId
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = cssFiles.get(virtualId)
        if (fileId === undefined) return null
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const tagId = `${PLUGIN_ID}/${basename(fileId)}`
        if (fileId.endsWith('.module.css')) {
          const { code, exports: cssExports } = transform({
            filename: fileId,
            code: source,
            cssModules: { pattern: `[hash]_[local]` },
            minify: true,
          })
          const classMap: Record<string, string> = {}
          for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
          return styleTagModule(fileId, code.toString(), tagId)
            + `\nexport default ${JSON.stringify(classMap)};`
        }
        return styleTagModule(fileId, source.toString(), tagId) + `\nexport default css;`
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: `return module.exports; } });`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
