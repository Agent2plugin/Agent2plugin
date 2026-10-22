# 索引格式

[English](index-format.md) · **简体中文**

描述一个插件需要两份文件：`index.json` 列出有哪些，`plugins/<id>.json`
承载某一家的明细。

## index.json

网关只读这一个文件来回答「有哪些插件」。它刻意做得很薄，不含任何版本细节
—— 那些在每家自己的文件里。这样列表是一次小请求，而每家的明细只在需要时
才拉。

```json
{
  "schema": 1,
  "updated": "2026-10-22",
  "plugins": [
    {
      "id": "agent2api-providers",
      "name": "提供商增强",
      "description": "各家提供商的转发、账号、签到与余额实现。",
      "source": { "type": "github-release", "repo": "ProvidersPlugin/Agent2Providers" },
      "manifest": "plugins/agent2api-providers.json",
      "official": true,
      "tags": ["official", "providers"]
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `schema` | 索引格式版本。改格式要同时改网关的读取逻辑 |
| `updated` | 最后更新日期（给人看的，网关不解析） |
| `plugins[].id` | 包 id，全局唯一，也是装好后的目录名 |
| `plugins[].name` | 显示名 |
| `plugins[].description` | 一句话说明，显示在插件列表里 |
| `plugins[].manifest` | 明细文件路径，必须形如 `plugins/<id>.json` |
| `plugins[].source` | 包从哪来。当前只支持 `github-release` |
| `plugins[].official` | 是否官方维护，界面上的徽标 |

## plugins/\<id\>.json

每家插件一份。网关据此拼出下载地址。

```json
{
  "id": "agent2api-providers",
  "name": "提供商增强",
  "version": "0.1.0",
  "protocol": 1,
  "homepage": "https://github.com/ProvidersPlugin/Agent2Providers",
  "license": "AGPL-3.0",
  "official": true,
  "release": {
    "repo": "ProvidersPlugin/Agent2Providers",
    "tag": "v{version}",
    "asset": "{id}-{version}-{target}.zip"
  },
  "platforms": [
    "x86_64-pc-windows-msvc",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu"
  ],
  "providers": [
    { "id": "demo", "label": "示例提供商", "order": 0, "default_enabled": false }
  ]
}
```

`id` 必须与 `index.json` 里的条目一致。写岔了比报错更糟：界面显示一家，
装进去的是另一家。

`protocol` 必须等于网关的 `PROTOCOL_VERSION`（当前 `1`）。不一致的包装得上
但握手失败，所以 `validate.mjs` 会在提交前拦住。

## 两个模板字符串

`release.tag` 和 `release.asset` 是模板，`{version}`、`{id}`、`{target}`
会被替换：

| 模板 | 替换后 |
|---|---|
| `v{version}` | `v0.1.0` |
| `{id}-{version}-{target}.zip` | `agent2api-providers-0.1.0-x86_64-pc-windows-msvc.zip` |

资产名必须**逐字**匹配。网关不做模糊匹配，因为下错平台的包只会在启动时
失败，而错误信息指向「插件启动失败」，很难反查到是文件名写错。

## 一个仓库放多个插件

这是索引支持、而「直接查插件仓库 Release」做不到的事。三种做法，可以在
同一份 `index.json` 里混用。

### 做法一：同一仓库的不同 tag 前缀（推荐）

```
仓库：Agent2plugin/Agent2plugin
  tag demo-v0.1.0    → agent2plugin-demo-0.1.0-<target>.zip
  tag tools-v0.2.0   → agent2plugin-tools-0.2.0-<target>.zip
```

明细里写 `"tag": "demo-v{version}"`，两个插件互不干扰。

### 做法二：同一个 Release 挂多个资产

一个 tag 下同时挂多个插件的 zip。这时 `tag` 固定，靠 `asset` 模板里的
`{id}` 区分。适合「一组插件同步发版」的场景。

### 做法三：不同仓库各发各的

明细里的 `release.repo` 各自指向不同仓库。适合第三方插件 —— 他们自己维护、
自己发版，只往本仓库提一个 JSON 条目。

## 校验

```bash
node scripts/validate.mjs
```

检查每个条目能否解析、id 是否唯一、`manifest` 指向的文件是否存在且与索引
条目一致、`protocol` 是否匹配、模板占位符是否齐全。提交前跑一次。

[`schema/`](../schema) 里的 JSON Schema 是同一套规则的机器可读形态。
