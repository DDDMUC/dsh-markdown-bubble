/**
 * dsh-markdown-bubble —— 宿主半部。
 *
 * 渲染本身完全在浏览器半部；宿主这边只负责一件事：**记住用户选的外观**
 * （`layout: 'bubble' | 'full'`），并通过一条只读本机路由把它交给页面。
 *
 * 为什么需要它：外观是客户端的事，但「用户选了什么」必须跨重启、跨窗口一致，
 * 不能存在某个 tab 的 localStorage 里。配置文件放在
 * `~/.dsh/dsh-markdown-bubble/config.json`，坏了就当默认值，不影响渲染。
 *
 * @module dsh-markdown-bubble
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 稳定插件 id（与 bundle patch、client 模块 id 一致）。 */
export const PLUGIN_ID = 'dsh-markdown-bubble'

/** 与 package.json / src/client.js 保持同步。 */
export const PLUGIN_VERSION = '0.2.0'

/** Cordis 插件名；bundle patch 用这个名字解析包。 */
export const name = PLUGIN_ID

/** 需要 webServer 注册配置路由。 */
export const inject = ['webServer']

/** 路由前缀。 */
const ROUTE_PREFIX = '/api/dsh-markdown-bubble'

/** 合法外观。 */
const LAYOUTS = new Set(['bubble', 'full'])

/** 配置路径。 */
export function configPath(home = os.homedir()) {
  return path.join(home, '.dsh', 'dsh-markdown-bubble', 'config.json')
}

/**
 * 读配置；缺失或损坏回默认值。
 * @param {string} [home] - 家目录（测试用）。
 * @returns {{ layout: 'bubble' | 'full' }} 配置。
 */
export function readConfig(home = os.homedir()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(home), 'utf8'))
    const layout = typeof parsed?.layout === 'string' ? parsed.layout : ''
    return { layout: LAYOUTS.has(layout) ? layout : 'bubble' }
  } catch {
    return { layout: 'bubble' }
  }
}

/**
 * 写配置（先临时文件再改名）。
 * @param {{ layout: string }} next - 新配置。
 * @param {string} [home] - 家目录（测试用）。
 * @returns {{ layout: 'bubble' | 'full' }} 落盘后的配置。
 */
export function writeConfig(next, home = os.homedir()) {
  const layout = LAYOUTS.has(next?.layout) ? next.layout : 'bubble'
  const file = configPath(home)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify({ layout }))
    fs.renameSync(file + '.tmp', file)
  } catch {
    // 写不进去就用内存里的值，界面不必因此报错。
  }
  return { layout }
}

/** 只放行本机请求。 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** 发送 JSON。 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

/**
 * 挂载配置路由。
 * @param {object} ctx - cordis 上下文。
 */
export function apply(ctx) {
  const webServer = ctx.get('webServer')
  const register = (server, fiber) => {
    fiber.effect(() =>
      server.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/config`,
        handler: (req, res) => {
          if (!isLoopback(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' })
          if (req.method === 'GET') return sendJson(res, 200, { ok: true, ...readConfig() })
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'GET or POST' })
          let raw = ''
          req.on('data', (chunk) => {
            raw += chunk
            if (raw.length > 4096) req.destroy()
          })
          req.on('end', () => {
            try {
              const body = raw === '' ? {} : JSON.parse(raw)
              sendJson(res, 200, { ok: true, ...writeConfig(body) })
            } catch {
              sendJson(res, 400, { ok: false, error: 'malformed JSON body' })
            }
          })
        },
      }),
    )
  }
  if (webServer) register(webServer, ctx)
  else if (typeof ctx.inject === 'function') ctx.inject(['webServer'], (sub) => register(sub.webServer, sub))
}
