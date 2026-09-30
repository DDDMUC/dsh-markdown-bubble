/**
 * dsh-markdown-bubble — host half.
 *
 * The plugin has no host-side behavior: a sent message's bubble is drawn by
 * the browser's chat view, and how it renders is a client-side projection of
 * the same text the drawer already receives. The host row exists so the
 * package is mounted by the Loader — the client-module scanner scans Loader
 * entries for packages declaring `dsh.client` — and so the bundle patch has a
 * row id to insert.
 *
 * @module dsh-markdown-bubble
 */

/** Stable plugin id (matches the bundle patch's insert id and the client module id). */
export const PLUGIN_ID = 'dsh-markdown-bubble'

/** Keep in sync with package.json and src/client.js. */
export const PLUGIN_VERSION = '0.1.1'

/** Cordis plugin name; the bundle patch resolves the package by this row. */
export const name = PLUGIN_ID

/** Services the inert entry needs: none. */
export const inject = []

/**
 * Inert apply: the browser half owns every behavior.
 * @param {import('@deepseek-ai/cordis').Context} _ctx - owning context.
 */
export function apply(_ctx) {}
