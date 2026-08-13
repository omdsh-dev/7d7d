/**
 * 游戏库静态文件服务：目录默认 index.html、越界 403、坏转义 400、
 * 未命中 404、未知扩展 octet-stream。GET/HEAD 由调用方把关。
 * @module 7d7d/static
 */

import type { ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.swf': 'application/x-shockwave-flash',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

/** URL 路径名安全解码：坏转义返回 null（调用方回 400）。 */
function safeDecode(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

/**
 * 服务一个 GET/HEAD 静态请求。
 * @param pathname - 已按 URL 解析出的 pathname（未解码）。
 * @param res - node:http 响应。
 * @param root - 物理根目录（绝对路径）。
 * @param head - HEAD 请求：只写头不写体。
 * @returns 是否命中（false = 404/400/403，调用方无需再回 404）。
 */
export async function serveStatic(pathname: string, res: ServerResponse, root: string, head = false): Promise<boolean> {
  const decoded = safeDecode(pathname)
  if (decoded === null) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('bad request')
    return true
  }
  const target = resolve(normalize(join(root, decoded)))
  // 越界拒绝：目标必须是 root 本身（`/`）或位于其下。用 sep 而非 '/'
  // 是因为 resolve() 在 Windows 上会产出反斜杠路径。
  if (target !== root && !target.startsWith(root + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
    return true
  }
  let file = target
  try {
    const info = await stat(target)
    if (info.isDirectory()) file = join(target, 'index.html')
  } catch {
    // 落到 readFile 里统一 404
  }
  let body: Buffer
  try {
    body = await readFile(file)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    if (!head) res.end('not found')
    else res.end()
    return true
  }
  const type = MIME[extname(file)] ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  if (!head) res.end(body)
  else res.end()
  return true
}
