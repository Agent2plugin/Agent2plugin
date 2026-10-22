#!/usr/bin/env node
/**
 * 索引自检：校验 `index.json` 与 `plugins/*.json` 的一致性。
 *
 * ── 为什么需要这个脚本 ──────────────────────────────────────
 * 这个仓库的全部价值是「网关照着一份 JSON 去装插件」。那份 JSON 写错一个
 * 字段，网关那边的表现是「插件列表是空的」或「装到一半报格式错」——
 * 两种都很难从现场反推回是哪一行。所以把「格式对不对」这件事在提交前
 * 用一个脚本钉死，而不是等用户撞上。
 *
 * ── 查什么 ──────────────────────────────────────────────────
 *   1. `index.json` 能被解析，`schema` 是当前支持的版本；
 *   2. 每个条目的 `id` 唯一，且 `manifest` 指向的文件真实存在；
 *   3. 每个明细文件的 `id` 与索引条目一致（写岔就是「点进去是另一家」）；
 *   4. `protocol` 与当前网关一致（不一致的包装了也握手失败）；
 *   5. `platforms` 非空，`release` 模板里的占位符齐全；
 *   6. 明细里的 `providers[].id` 不重复。
 *
 * 用法：
 * ```bash
 * node scripts/validate.mjs
 * ```
 * 退出码：0 = 全部通过；1 = 有问题（逐条打印）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_DIR = resolve(HERE, '..')

/** 当前网关支持的协议版本（与 `agent2api-provider-protocol` 的 PROTOCOL_VERSION 同值）。 */
const PROTOCOL_VERSION = 1

/** 支持的索引格式版本。改格式要同时改网关的读取逻辑。 */
const SCHEMA_VERSION = 1

const errors = []
const warnings = []

function fail(message) {
  errors.push(message)
}

function warn(message) {
  warnings.push(message)
}

function readJson(path) {
  if (!existsSync(path)) {
    fail(`文件不存在：${path}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    fail(`不是合法 JSON（${path}）：${e.message}`)
    return null
  }
}

function checkIndex() {
  const indexPath = join(REPO_DIR, 'index.json')
  const index = readJson(indexPath)
  if (!index) return

  if (index.schema !== SCHEMA_VERSION) {
    fail(`index.json 的 schema 是 ${index.schema}，本仓库当前是 ${SCHEMA_VERSION}`)
  }
  if (!Array.isArray(index.plugins)) {
    fail('index.json 的 plugins 必须是数组')
    return
  }
  if (index.plugins.length === 0) {
    warn('index.json 里一个插件都没有')
  }

  const seen = new Set()
  for (const entry of index.plugins) {
    const where = `index.json → ${entry.id || '(缺 id)'}`
    if (!entry.id) {
      fail(`${where}：缺少 id`)
      continue
    }
    if (seen.has(entry.id)) {
      fail(`${where}：id 重复`)
    }
    seen.add(entry.id)

    if (!entry.name) fail(`${where}：缺少 name`)
    if (!entry.manifest) {
      fail(`${where}：缺少 manifest（指向 plugins/<id>.json）`)
      continue
    }
    if (!entry.manifest.startsWith('plugins/') || !entry.manifest.endsWith('.json')) {
      fail(`${where}：manifest 应形如 plugins/<id>.json（实际 ${entry.manifest}）`)
    }
    if (!existsSync(join(REPO_DIR, entry.manifest))) {
      fail(`${where}：manifest 指向的文件不存在（${entry.manifest}）`)
      continue
    }
    checkPluginFile(entry, entry.manifest)
  }
}

function checkPluginFile(indexEntry, manifestPath) {
  const file = readJson(join(REPO_DIR, manifestPath))
  if (!file) return
  const where = manifestPath

  // ── id 必须与索引一致 ──────────────────────────────────────
  // 写岔的后果不是报错，而是「界面上显示 A，点安装装的是 B」——
  // 静默装错，比装不上更糟。
  if (file.id !== indexEntry.id) {
    fail(`${where}：id（${file.id}）与索引条目（${indexEntry.id}）不一致`)
  }
  if (!file.name) fail(`${where}：缺少 name`)
  if (!file.version) fail(`${where}：缺少 version`)

  if (file.protocol !== PROTOCOL_VERSION) {
    fail(`${where}：protocol 是 ${file.protocol}，当前网关是 ${PROTOCOL_VERSION}（装了也握手失败）`)
  }

  // ── 发布信息 ───────────────────────────────────────────────
  if (!file.release || typeof file.release !== 'object') {
    fail(`${where}：缺少 release（网关据此查 Release 资产）`)
  } else {
    if (!file.release.repo || !file.release.repo.includes('/')) {
      fail(`${where}：release.repo 应形如 owner/repo`)
    }
    for (const key of ['tag', 'asset']) {
      const template = file.release[key]
      if (!template) {
        fail(`${where}：release.${key} 缺失`)
        continue
      }
      // asset 模板必须带这三个占位符，否则拼不出各平台的包名
      if (key === 'asset') {
        for (const placeholder of ['{id}', '{version}', '{target}']) {
          if (!template.includes(placeholder)) {
            fail(`${where}：release.asset 缺少占位符 ${placeholder}（实际 ${template}）`)
          }
        }
      }
      if (key === 'tag' && !template.includes('{version}')) {
        fail(`${where}：release.tag 缺少占位符 {version}（实际 ${template}）`)
      }
    }
  }

  // ── 平台 ───────────────────────────────────────────────────
  if (!Array.isArray(file.platforms) || file.platforms.length === 0) {
    fail(`${where}：platforms 必须是非空数组`)
  }

  // ── provider 列表 ──────────────────────────────────────────
  if (!Array.isArray(file.providers) || file.providers.length === 0) {
    fail(`${where}：providers 必须是非空数组`)
    return
  }
  const providerIds = new Set()
  for (const provider of file.providers) {
    if (!provider.id) {
      fail(`${where}：providers 里有一项缺少 id`)
      continue
    }
    if (providerIds.has(provider.id)) {
      fail(`${where}：provider id 重复（${provider.id}）`)
    }
    providerIds.add(provider.id)
    if (!provider.label) {
      warn(`${where}：provider ${provider.id} 没有 label（界面会显示 id）`)
    }
  }
}

checkIndex()

if (errors.length === 0) {
  console.log('[validate] 索引校验通过')
  for (const message of warnings) console.warn(`[validate] 警告：${message}`)
  process.exit(0)
}
console.error(`[validate] 发现 ${errors.length} 个问题：`)
for (const message of errors) console.error(`  · ${message}`)
process.exit(1)
