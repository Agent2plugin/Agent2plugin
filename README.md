# Agent2plugin

**English** · [简体中文](README.zh-CN.md)

## Plugins

| Plugin | Description |
|---|---|
| [Provider Enhancements](plugins/agent2api-providers.json) | Forwarding, accounts, check-in and balance across AI providers, including Doubao Work. Capabilities vary by provider. |
| [Web Providers](plugins/agent2api-web-providers.json) | Model calls for ChatGLM and DeepSeek web accounts; credential renewal, model catalogs, points and check-in vary by provider. |
| [Demo Plugin](examples/demo-plugin) | A minimal plugin that compiles, installs and runs. The template for writing your own. |

## Docs

- [Writing a plugin](docs/writing-a-plugin.md) — implement `Provider`, write
  `pack.json`, build, pack and publish. The demo lives at
  [`examples/demo-plugin`](examples/demo-plugin).

## License

AGPL-3.0
