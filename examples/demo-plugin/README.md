# 示例插件

一个最小可运行的 Agent2API 插件。它**不是**给用户用的 —— 它是写插件的起点。

## 它做了什么

接一个假的上游地址（`http://127.0.0.1:9/echo`），把客户端请求原样转过去。
所以它跑不通真实对话，但整条链路是真的：

```
网关 → 插件进程 → 假上游 → 插件 → 网关 → 客户端
```

协议握手、能力申报、流式帧、背压、取消，全部由 SDK 的 `serve_blocking()`
处理，这个文件里看不到一个帧。

## 三个必答的地方

**`src/main.rs` 里的 `ID`** —— provider id。必须与 `pack.json` 的
`providers[].id` 逐字一致。写岔的表现是「装上了但列表里没有这一家」。

**`meta()`** —— 我是谁、支持什么。能力位**老实填**，`Default::default()`
里除了 `chat` 全是 `false`，只打开真正实现了的那几位。填错的后果不是
「不生效」，而是界面上出现一个点了必然报错的按钮。

**`build_chat()`** —— 拼上游 URL 和鉴权头。出网（代理、超时、SSE 解析）
由网关统一做，插件不碰传输层。

## 编译与打包

```bash
cargo build --release
cd ../..
node scripts/pack.mjs --plugin examples/demo-plugin --skip-build
```

zip 落在仓库根的 `dist/`，网关界面「提供商插件 → 从文件安装」可直接选中。

## 改成一个真实的 provider

按这个顺序改，每步都能单独验证：

1. **改 `ID` 和 `meta()` 的 label**，同步改 `pack.json` 里那两处；
2. **改 `UPSTREAM`** 成真实的上游地址，`build_chat()` 里的鉴权头换成读账号令牌
   （用 `ctx.store_get()`，别自己开库）；
3. **打开对应的能力位**，并实现相应的方法 —— 申报了 `usage: true` 就要实现
   `usage()`，否则界面上的「积分」按钮点了必然失败；
4. **需要错误分类时**实现 `classify()`，把上游的 429 / 401 / 内容拦截
   映射到协议里的四档（配额、令牌过期、内容拦截、致命）。

## 关于依赖

`Cargo.toml` 里 SDK 与协议库都是按 **tag** 依赖：

```toml
agent2api-provider-sdk = { git = "https://github.com/ProvidersPlugin/Agent2Providers", tag = "v0.1.0" }
```

不用 path 依赖，是为了让任何人 clone 这个仓库就能 `cargo build` —— 不需要
本地同时放一份 Agent2Providers。协议改了会换新 tag，而不是让依赖悬空。
