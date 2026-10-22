//! Agent2API 示例插件。
//!
//! ── 这个文件要教你什么 ──────────────────────────────────────
//! 一个插件的最小完整形态：
//!   1. 实现 [`Provider`] trait 的两个必答方法（`meta` 与数据面）；
//!   2. 调 `serve_blocking()` 把进程变成网关能加载的宿主；
//!   3. 配一份 `pack.json` 让网关知道怎么启动你。
//!
//! ── 它做什么 ────────────────────────────────────────────────
//! 接一个假的本地上游（`http://127.0.0.1:9/echo`），把客户端请求原样
//! 转过去。所以它**不能真的用**，但整条链路是真的：网关 → 插件 →
//! 上游 → 插件 → 网关 → 客户端。
//!
//! ── 抄结构，不要抄逻辑 ──────────────────────────────────────
//! 真实 provider 要改的是这三处：
//!   · `meta()` 里的 id / label / 能力位 / 登录方式；
//!   · `build_chat()` 里的 URL 与请求头（鉴权头在这里）；
//!   · 需要的话加 `classify()` 做错误分类。
//! 其余保持默认即可 —— 默认实现一律返回「不支持」，不会误报能力。

use agent2api_provider_protocol as proto;
use agent2api_provider_sdk::{ChatPlan, PluginCtx, Provider, ProviderMeta, SendFuture};

/// provider id。必须与 `pack.json` 的 `providers[].id` 逐字一致 ——
/// 网关按这个 id 路由请求，两边写岔的表现是「装上了但列表里没有」。
const ID: &str = "demo";

/// 假上游的地址。真实 provider 换成 `https://api.example.com/v1/chat/completions`。
const UPSTREAM: &str = "http://127.0.0.1:9/v1/chat/completions";

pub struct DemoProvider;

impl Provider for DemoProvider {
    fn meta(&self) -> ProviderMeta {
        // ── 能力位要老实填 ────────────────────────────────────
        // `Default::default()` 里全是 false（除了 `chat` 为 true），
        // 只打开你真正实现了的那几位。填错的后果不是「不生效」，
        // 而是界面上出现一个点了必然报错的按钮。
        let mut capabilities = proto::Capabilities::default();
        capabilities.chat = true;
        capabilities.stateful = false;

        ProviderMeta::new(ID, "示例提供商")
            .with_capabilities(capabilities)
            .with_login(vec![proto::LoginMethod::Token {
                label: "示例令牌".into(),
                placeholder: "粘贴 demo_ 开头的令牌".into(),
                extra_fields: vec![],
            }])
            .with_models(vec![
                serde_json::json!({
                    "id": "demo-fast",
                    "name": "Demo Fast",
                    "context_length": 8192,
                }),
                serde_json::json!({
                    "id": "demo-slow",
                    "name": "Demo Slow",
                    "context_length": 32768,
                }),
            ])
    }

    /// 无状态转发：构造一个发往上游的请求，网关替我们发出去。
    ///
    /// ── 为什么返回 ChatPlan 而不是自己发请求 ──────────────────
    /// 出网（代理、超时、重试、SSE 解析）都在网关侧统一做，插件只负责
    /// 「拼 URL 和请求头」这件事。这样一家 provider 的鉴权逻辑不会和
    /// 传输逻辑缠在一起，也省掉每个插件各写一遍 HTTP 客户端。
    fn build_chat<'a>(
        &'a self,
        _ctx: &'a PluginCtx,
        req: proto::ChatRequest,
    ) -> SendFuture<'a, ChatPlan> {
        Box::pin(async move {
            // 鉴权头在这里加。真实 provider 通常从账号里读令牌：
            //   let token = ctx.store_get(&req.account, "token").await?;
            // 这个示例没有账号，所以写一个固定值。
            let headers = vec![
                ("authorization".to_string(), "Bearer demo-token".to_string()),
                ("content-type".to_string(), "application/json".to_string()),
            ];
            Ok(ChatPlan::chat(UPSTREAM, headers, req.body))
        })
    }
}

fn main() {
    // 把 provider 装进注册表交给 SDK。`serve_blocking` 会：
    // 建运行时 → 握手 → 读循环 → 按请求派发到各个 provider。
    // 作者不需要看见任何一个帧。
    agent2api_provider_sdk::serve_blocking(vec![Box::new(DemoProvider)]);
}
