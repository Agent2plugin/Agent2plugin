# Agent2plugin

[English](README.md) · **简体中文**

## 插件列表

| 插件 | 功能 |
|---|---|
| [提供商增强](plugins/agent2api-providers.json) | 多家 AI 提供商的转发、账号、签到与余额实现，包含豆包工作；具体功能以各家支持情况为准。 |
| [网页提供商](plugins/agent2api-web-providers.json) | 智谱清言与 DeepSeek 网页账号的模型调用；具体续期、目录、积分与签到能力以各提供商声明为准。 |
| [示例插件](examples/demo-plugin) | 一个能编译、能安装、能运行的最小插件，也是写自己插件的模板。 |

## 文档

- [编写插件](docs/writing-a-plugin.zh-CN.md) —— 实现 `Provider`、写 `pack.json`、
  编译、打包、发布。示例在 [`examples/demo-plugin`](examples/demo-plugin)。

## License

AGPL-3.0
