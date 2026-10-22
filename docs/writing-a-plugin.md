# Writing a plugin

**English** · [简体中文](writing-a-plugin.zh-CN.md)

A plugin is a standalone executable. The gateway starts it and talks to it over
newline-delimited JSON on stdin and stdout. You implement one trait and call one
function; framing, backpressure, cancellation and logging stay inside the SDK.

## The demo

[`examples/demo-plugin`](../examples/demo-plugin) is a working plugin. It
compiles, installs into the gateway and completes the protocol handshake. Read
it before writing your own — it is the template.

It implements only two methods, `meta()` and `build_chat()`. Everything else
falls back to defaults that report "not supported". That is the point: a plugin
starts small and grows capability by capability.

```bash
cd examples/demo-plugin
cargo build --release
```

## Steps

### 1. Create the crate

```toml
[dependencies]
agent2api-provider-protocol = { git = "https://github.com/ProvidersPlugin/Agent2Providers", tag = "v0.1.0" }
agent2api-provider-sdk = { git = "https://github.com/ProvidersPlugin/Agent2Providers", tag = "v0.1.0" }
serde_json = "1"
```

Depend on the SDK by **tag**, not by path. Anyone who clones your repository
must be able to run `cargo build` without a second checkout of Agent2Providers.

### 2. Implement `Provider`

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

Only `meta()` is required. Everything else has a default.

### 3. Turn on capability bits honestly

`Capabilities::default()` has `chat: true` and everything else `false`. Turn on
a bit only when you implement the matching method. A bit set but not implemented
does not fail silently — it puts a button in the UI that errors when clicked.

| Bit | Implement to match |
|---|---|
| `stateful` | `conversation()` — multi-step upstream protocol |
| `refresh` | `refresh_token()` |
| `model_refresh` | `refresh_models()` |
| `usage` | `usage()` |
| `checkin` | `checkin()` |
| `web_login` | `login_start()` / `login_poll()` / `login_callback()` |

### 4. Write `pack.json`

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

Two things must match your code exactly:

- `providers[].id` must equal the `ID` constant. A mismatch installs fine and
  then never shows up in the provider list.
- `entry` paths must point at the binary your build produces, under `bin/`.

`icons` is optional. Put a `logo.png` there and the gateway shows it on the
plugin card; without it the UI falls back to a letter badge.

### 5. Build and pack

```bash
cargo build --release
node scripts/pack.mjs --plugin path/to/your-plugin --skip-build
```

Or copy [`scripts/pack.mjs`](../scripts/pack.mjs) into your own repository. It
has no dependencies and runs on any machine with Node.

The zip lands in `dist/` and is named `<id>-<version>-<target>.zip`. That name
is a hard contract: the gateway matches it exactly when checking for updates.

### 6. Publish and register

1. Publish a GitHub Release in your repository and attach the zips;
2. Add `plugins/<id>.json` here;
3. Add an entry to `index.json`;
4. Run `node scripts/validate.mjs`;
5. Open a pull request.

See [index format](index-format.md) for the two JSON files.

## Testing without the gateway

The plugin speaks JSON lines. You can drive it by hand:

```bash
echo '{"type":"init","id":1}' | ./target/release/my-plugin
```

For a full protocol run — init, requests, streaming, backpressure,
cancellation, callbacks, crash recovery — use
[`scripts/verify.mjs`](https://github.com/ProvidersPlugin/Agent2Providers/blob/main/scripts/verify.mjs)
from the SDK repository.

## Rules that matter

**Never panic.** The plugin process is separate, so a panic does not take the
gateway down — but it does drop every in-flight request. The demo crate denies
`unwrap` and `expect` at compile time.

**Log through the SDK.** Use `log_info!` / `log_warn!` / `log_error!`, not
`eprintln!`. On Windows a GUI process has no console, so stderr goes nowhere;
the SDK routes logs to the gateway's log page.

**Let the gateway do the transport.** Return a `ChatPlan` and let the gateway
send it. Proxies, timeouts, retries and SSE parsing are handled once, in one
place. Only use `conversation()` when the upstream is genuinely multi-step.
