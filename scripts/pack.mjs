#!/usr/bin/env node
/**
 * 通用插件打包脚本：把一个插件目录里的 release 二进制 + pack.json 打成 zip。
 *
 * ── 为什么这个脚本在索引仓库里，而不是每个插件各带一份 ──────────
 * 这个仓库收的是**多家插件**（`examples/demo-plugin` 是第一家）。每个插件
 * 各带一份打包脚本会让「产物形状」有 N 个副本，任何一处改动都要改 N 遍，
 * 而网关只认一种形状。所以打包逻辑只有这一份，用 `--plugin` 指定打哪个。
 *
 * ── 产物形状（与网关 `plugin_host::install` 的期望逐字对应）──────
 * ```text
 * <pack.json 的 id>-<version>-<target>.zip
 *   pack.json                      ← 原样拷自插件目录的 pack.json
 *   <icons>/…                      ← pack.json 里 icons 目录下的全部文件
 *   bin/<二进制名>                  ← release 二进制
 * ```
 * 网关把 zip 解到 `plugins/<id>/<version>/`，读 `pack.json` 的 `entry`
 * 找二进制，所以**目录结构不能改**。
 *
 * ── 用法 ────────────────────────────────────────────────────
 * ```bash
 * node scripts/pack.mjs --plugin examples/demo-plugin
 * node scripts/pack.mjs --plugin examples/demo-plugin --target aarch64-apple-darwin
 * node scripts/pack.mjs --plugin examples/demo-plugin --skip-build
 * ```
 *
 * 退出码：0 = 成功；1 = 失败（目录不对 / 二进制不存在 / 清单与目标平台对不上）。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 本仓库根（脚本在 `<根>/scripts/` 下） */
const REPO_DIR = resolve(HERE, '..')

/**
 * 宿主平台的三元组（与网关 `plugin_host::rpc::target_triple()` 同一口径）。
 *
 * ⚠ 这个字符串有四个消费方，必须逐字一致：`HostEnv.target`、`pack.json` 的
 *  `entry` 键、签名载荷里的 `target=`、更新资产名 `…-<target>.zip`。
 */
function hostTriple() {
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch
  switch (process.platform) {
    case 'win32': return `${arch}-pc-windows-msvc`
    case 'darwin': return `${arch}-apple-darwin`
    default: return `${arch}-unknown-linux-gnu`
  }
}

/**
 * 目标平台的入口二进制路径（从清单里取，不猜名字）。
 *
 * 与官方插件包不同，这里**不假设**二进制叫某个固定名字 —— 这个仓库要装
 * 多家插件，名字由各自的 `pack.json` 决定。只做一件事：把清单里的
 * `bin/xxx` 换成 `target/release/xxx`。
 */
function binaryPath(pluginDir, entry, target, host) {
  const name = entry.split('/').pop()
  const native = target === host
  return native
    ? join(pluginDir, 'target', 'release', name)
    : join(pluginDir, 'target', target, 'release', name)
}

function parseArgs(argv) {
  const options = { plugin: '', out: '', build: true, target: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--plugin') options.plugin = argv[++index] || ''
    else if (arg === '--out') options.out = resolve(argv[++index] || '')
    else if (arg === '--target') options.target = argv[++index] || ''
    else if (arg === '--skip-build') options.build = false
    else if (arg === '--help' || arg === '-h') {
      console.log('用法: node scripts/pack.mjs --plugin <插件目录> [--target <三元组>] [--out <目录>] [--skip-build]')
      process.exit(0)
    } else {
      console.error(`未知参数：${arg}`)
      process.exit(1)
    }
  }
  return options
}

/**
 * 最小 zip 写入器（store 模式，不压缩）。
 *
 * 与官方插件包同一个实现：不引 archiver / jszip，因为这个脚本要在任何
 * 开发机与 CI runner 上直接跑，而仓库没有 node_modules。
 */
function crc32(buffer) {
  let table = crc32.table
  if (!table) {
    table = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      }
      table[index] = value >>> 0
    }
    crc32.table = table
  }
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = table[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** DOS 时间戳（固定值，让同一份输入产出相同字节） */
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

function writeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt16LE(0, 8) // store
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(size, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    // 外部属性高 16 位是 Unix mode：二进制 0755，其余 0644。
    // 少了这一项，Linux / macOS 解出来的二进制没有执行位（EACCES）。
    const mode = entry.executable ? 0o100755 : 0o100644
    central.writeUInt32LE((mode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)

    offset += local.length + nameBytes.length + size
  }
  const centralSize = centrals.reduce((total, item) => total + item.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, end])
}

/**
 * 收集清单 `icons` 目录下的全部文件。
 *
 * 路径校验与网关 `validate_manifest` 同一套：相对路径、不含 `..`。
 * 目录不存在时不报错（`icons` 是可选字段）。
 */
function collectIcons(pluginDir, manifest) {
  const dir = manifest.icons
  if (!dir) return []
  if (dir.startsWith('/') || dir.startsWith('\\') || /^[a-zA-Z]:/.test(dir)) {
    throw new Error(`pack.json 的 icons 必须是相对路径（${dir}）`)
  }
  if (dir.split(/[\\/]/).includes('..')) {
    throw new Error(`pack.json 的 icons 不能包含 ..（${dir}）`)
  }
  const root = join(pluginDir, dir)
  if (!existsSync(root) || !statSync(root).isDirectory()) return []

  const files = []
  const walk = current => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, item.name)
      if (item.isDirectory()) {
        walk(full)
      } else if (item.isFile()) {
        files.push({
          name: relative(pluginDir, full).split('\\').join('/'),
          data: readFileSync(full),
          executable: false,
        })
      }
    }
  }
  walk(root)
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.plugin) {
    console.error('[pack] 必须用 --plugin 指定插件目录（例如 --plugin examples/demo-plugin）')
    process.exit(1)
  }
  const pluginDir = resolve(REPO_DIR, options.plugin)
  if (!existsSync(join(pluginDir, 'pack.json'))) {
    console.error(`[pack] 这个目录里没有 pack.json：${pluginDir}`)
    process.exit(1)
  }

  const host = hostTriple()
  const target = options.target || host
  const outDir = options.out || join(REPO_DIR, 'dist')

  // 先校验清单（便宜），再编 / 找二进制（贵）——
  // 顺序反过来时 `--target` 写错，用户看到的是「找不到二进制」而不是
  // 「这个平台没在清单里声明」。
  const manifest = JSON.parse(readFileSync(join(pluginDir, 'pack.json'), 'utf8'))
  const entry = manifest.entry?.[target]
  if (!entry) {
    console.error(`[pack] pack.json 的 entry 里没有目标平台（${target}）`)
    console.error(`[pack] 现有条目：${Object.keys(manifest.entry || {}).join(', ') || '(空)'}`)
    process.exit(1)
  }

  const exe = binaryPath(pluginDir, entry, target, host)
  if (options.build) {
    const args = ['build', '--release']
    if (target !== host) args.push('--target', target)
    console.log(`[pack] 编译 release 产物（cargo ${args.join(' ')}）…`)
    execFileSync('cargo', args, { cwd: pluginDir, stdio: 'inherit' })
  }
  if (!existsSync(exe)) {
    console.error(`[pack] 找不到 release 二进制：${exe}`)
    console.error(`[pack] 先跑一次 \`cd ${pluginDir} && cargo build --release\`，或去掉 --skip-build`)
    process.exit(1)
  }

  const zipName = `${manifest.id}-${manifest.version}-${target}.zip`
  const zipPath = join(outDir, zipName)
  mkdirSync(outDir, { recursive: true })

  const binary = readFileSync(exe)
  const icons = collectIcons(pluginDir, manifest)
  const zip = writeZip([
    { name: 'pack.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), executable: false },
    ...icons,
    { name: entry, data: binary, executable: true },
  ])
  writeFileSync(zipPath, zip)

  const binaryMb = (statSync(exe).size / 1024 / 1024).toFixed(2)
  const zipMb = (zip.length / 1024 / 1024).toFixed(2)
  console.log(`[pack] 插件      ${manifest.id} v${manifest.version}`)
  console.log(`[pack] 平台      ${target}${target === host ? '（宿主）' : '（交叉）'}`)
  console.log(`[pack] 二进制    ${binaryMb} MB`)
  console.log(`[pack] 图标      ${icons.length ? `${icons.length} 个（${manifest.icons}/）` : '无'}`)
  console.log(`[pack] 插件包    ${zipPath}`)
  console.log(`[pack] 体积      ${zipMb} MB（store 模式，未压缩）`)
}

main()
