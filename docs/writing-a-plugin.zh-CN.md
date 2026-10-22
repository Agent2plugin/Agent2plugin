# 编写插件

[English](writing-a-plugin.md) · **简体中文**

插件是一个独立可执行文件。网关启动它，通过 stdin/stdout 上的换行分隔 JSON
与它通信。你实现一个 trait、调用一个函数；分帧、背压、取消和日志都封装在
SDK 里。

## 示例插件

[`examples/demo-plugin`](../examples/demo-plugin) 是一个能用的插件。它能编译、
能被网关安装、能完成协议握手。写自己的插件之前先读它 —— 它就是模板。

它只实现了两个方法：`meta()` 和 `build_chat()`。其余全部走默认实现，
默认一律报「不支持」。这正是要点：插件从小开始，一个能力一个能力地长。

```bash
cd examples/demo-plugin
cargo build --release
```

## 步骤

### 1. 建 crate

```toml
[dependencies]
agent2api-provider-protocol = { git = "https://github.com/ProvidersPlugin/Agent2Providers", tag = "v0.1.0" }
agent2api-provider-sdk = { git = "https://github.com/ProvidersPlugin/Agent2Providers", tag = "v0.1.0" }
serde_json = "1"
```

按 **tag** 依赖 SDK，不要用 path。任何人 clone 你的仓库都应该能直接
`cargo build`，不需要额外 clone 一份 Agent2Providers。

### 2. 实现 `Provider`

```rust
use agent2api_provider_protocol as proto;
use agent2api_provider_sdk::{ChatPlan, PluginCtx, Provider, ProviderMeta, SendFuture};

const ID: &str = "my-provider";

struct MyProvider;

impl Provider for MyProvider {
    fn meta(&self) -> ProviderMeta {
        let mut capabilities = proto::Capabilities::default();
        capabilities.chat = true;

        ProviderMeta::new(ID, "My Provider")
            .with_capabilities(capabilities)
            .with_models(vec![serde_json::json!({
                "id": "my-model",
                "name": "My Model",
                "context_length": 8192,
            })])
    }

    fn build_chat<'a>(
        &'a self,
        _ctx: &'a PluginCtx,
        req: proto::ChatRequest,
    ) -> SendFuture<'a, ChatPlan> {
        Box::pin(async move {
            let headers = vec![
                ("authorization".to_string(), "Bearer token".to_string()),
                ("content-type".to_string(), "application/json".to_string()),
            ];
            Ok(ChatPlan::chat("https://api.example.com/v1/chat/completions", headers, req.body))
        })
    }
}

fn main() {
    agent2api_provider_sdk::serve_blocking(vec![Box::new(MyProvider)]);
}
```

只有 `meta()` 是必答的，其余都有默认实现。

### 3. 能力位要老实填

`Capabilities::default()` 里 `chat` 是 `true`，其余全是 `false`。只在你实现了
对应方法时才打开某一位。开了却没实现的后果不是「静默失效」，而是界面上多
一个点了必然报错的按钮。

| 能力位 | 需要实现 |
|---|---|
| `stateful` | `conversation()` —— 上游是多步会话协议 |
| `refresh` | `refresh_token()` |
| `model_refresh` | `refresh_models()` |
| `usage` | `usage()` |
| `checkin` | `checkin()` |
| `web_login` | `login_start()` / `login_poll()` / `login_callback()` |

### 4. 写 `pack.json`

```json
{
  "id": "my-provider-plugin",
  "name": "My Provider Plugin",
  "version": "0.1.0",
  "protocol": 1,
  "providers": [
    { "id": "my-provider", "label": "My Provider", "order": 0, "default_enabled": true }
  ],
  "icons": "assets",
  "entry": {
    "x86_64-pc-windows-msvc": "bin/my-provider-plugin.exe",
    "x86_64-unknown-linux-gnu": "bin/my-provider-plugin",
    "aarch64-unknown-linux-gnu": "bin/my-provider-plugin",
    "x86_64-apple-darwin": "bin/my-provider-plugin",
    "aarch64-apple-darwin": "bin/my-provider-plugin"
  }
}
```

两处必须与代码逐字一致：

- `providers[].id` 要等于代码里的 `ID` 常量。写岔了包装得上，但永远不出现在
  提供商列表里。
- `entry` 路径要指向构建产物，且放在 `bin/` 下。

`icons` 是可选的。放一张 `logo.png` 进去，网关就会在插件卡片上显示它；
没有则回落到字母徽章。

### 5. 编译与打包

```bash
cargo build --release
node scripts/pack.mjs --plugin path/to/your-plugin --skip-build
```

也可以把 [`scripts/pack.mjs`](../scripts/pack.mjs) 复制到你自己的仓库。它没有
任何依赖，有 Node 的机器都能跑。

zip 落在 `dist/`，文件名是 `<id>-<version>-<target>.zip`。这个名字是硬契约：
网关检查更新时按它精确匹配。

### 6. 发布与登记

1. 在你的仓库发一个 GitHub Release，把各平台的 zip 挂上去；
2. 在本仓库加 `plugins/<id>.json`；
3. 在 `index.json` 里加一条；
4. 跑 `node scripts/validate.mjs`；
5. 提 pull request。

两个 JSON 文件的格式见[索引格式](index-format.md)。

## 不借助网关自测

插件说的是 JSON 行，可以手工驱动：

```bash
echo '{"type":"init","id":1}' | ./target/release/my-plugin
```

要跑完整协议（init、请求、流式、背压、取消、回调、崩溃恢复），用 SDK 仓库里的
[`scripts/verify.mjs`](https://github.com/ProvidersPlugin/Agent2Providers/blob/main/scripts/verify.mjs)。

## 几条硬规矩

**不要 panic。** 插件是独立进程，panic 不会带走网关 —— 但会打断所有在途请求。
示例 crate 在编译期就 deny 了 `unwrap` 和 `expect`。

**日志走 SDK。** 用 `log_info!` / `log_warn!` / `log_error!`，不要用 `eprintln!`。
Windows 上 GUI 进程没有控制台，stderr 写进虚无；SDK 会把日志送到网关的日志页。

**传输交给网关。** 返回 `ChatPlan` 让网关去发。代理、超时、重试和 SSE 解析只在
一处处理。只有当上游真的是多步会话时才用 `conversation()`。
