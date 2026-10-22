# Index format

**English** · [简体中文](index-format.zh-CN.md)

Two files describe a plugin: `index.json` lists what exists, and
`plugins/<id>.json` carries the detail for one plugin.

## index.json

The gateway reads only this file to answer "which plugins exist". It is
deliberately thin and carries no version detail — that lives in the per-plugin
file, so the list is one small request and each plugin's detail is loaded only
when needed.

```json
{
  "schema": 1,
  "updated": "2026-10-22",
  "plugins": [
    {
      "id": "agent2api-providers",
      "name": "Provider Enhancements",
      "description": "Forwarding, accounts, check-in and balance for each provider.",
      "source": { "type": "github-release", "repo": "ProvidersPlugin/Agent2Providers" },
      "manifest": "plugins/agent2api-providers.json",
      "official": true,
      "tags": ["official", "providers"]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `schema` | Index format version. Changing it also changes the gateway's reader |
| `updated` | Last update date, for humans; the gateway does not parse it |
| `plugins[].id` | Package id, globally unique, also the directory name once installed |
| `plugins[].name` | Display name |
| `plugins[].description` | One line, shown in the plugin list |
| `plugins[].manifest` | Detail file path, must be `plugins/<id>.json` |
| `plugins[].source` | Where the package comes from. Currently only `github-release` |
| `plugins[].official` | Maintained by us, shown as a badge |

## plugins/\<id\>.json

One file per plugin. The gateway builds the download URL from it.

```json
{
  "id": "agent2api-providers",
  "name": "Provider Enhancements",
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
    { "id": "demo", "label": "Demo Provider", "order": 0, "default_enabled": false }
  ]
}
```

`id` must match the entry in `index.json`. A mismatch is worse than an error:
the UI shows one plugin and installs another.

`protocol` must equal the gateway's `PROTOCOL_VERSION` (currently `1`). A
package that disagrees installs but fails the handshake, so `validate.mjs`
rejects it before you commit.

## The two template strings

`release.tag` and `release.asset` are templates. `{version}`, `{id}` and
`{target}` are substituted:

| Template | Result |
|---|---|
| `v{version}` | `v0.1.0` |
| `{id}-{version}-{target}.zip` | `agent2api-providers-0.1.0-x86_64-pc-windows-msvc.zip` |

The asset name must match **exactly**. The gateway does no fuzzy matching,
because downloading the wrong platform's package only fails at spawn time, and
the error points at "plugin failed to start" — hard to trace back to a filename.

## Multiple plugins in one repository

This is what the index supports and what "query the plugin repository directly"
cannot do. Three approaches, and they can be mixed in one `index.json`.

### Option 1: tag prefixes in one repository (recommended)

```
repository: Agent2plugin/Agent2plugin
  tag demo-v0.1.0    → agent2plugin-demo-0.1.0-<target>.zip
  tag tools-v0.2.0   → agent2plugin-tools-0.2.0-<target>.zip
```

The detail file uses `"tag": "demo-v{version}"`, and the two plugins never
interfere.

### Option 2: multiple assets in one Release

A single tag carries the zips for several plugins. `tag` is fixed and `{id}` in
the `asset` template tells them apart. Suits a set of plugins released together.

### Option 3: one repository each

`release.repo` in each detail file points somewhere different. Suits third-party
plugins — they maintain and release their own work and only contribute a JSON
entry here.

## Validating

```bash
node scripts/validate.mjs
```

Checks that every entry parses, that ids are unique, that each `manifest` file
exists and agrees with its index entry, that `protocol` matches, and that the
template placeholders are present. Run it before committing.

The JSON Schemas in [`schema/`](../schema) are the machine-readable form of the
same rules.
