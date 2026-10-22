---
name: jev-browser-ultrafast
description: JEV 中央治理下的极速浏览器 Agent。用于有明确自然语言目标的多步网页操作、浏览器 SOP 和需要低延迟 DOM/ARIA 决策循环的任务。底层使用固定版本 jev-ultrafast + browser-harness，决策经 OpenRouter 的 TypeSafe Jev，所有高风险网页动作保持 JEV fail-closed。
---

# JEV Browser Ultrafast

## Position

这是“战神 JEV”的受管浏览器高速执行 Skill。

固定链路：

`JEV Skill Steward -> jev-browser-ultrafast -> TypeSafe Jev/OpenRouter -> browser-harness -> Chrome`

上游源码固定在：

`~/.local/src/jev-ultrafast-20260923`

固定提交：

`1231850a0bf1a0c0341fe408ef1668dbbfdfac46`

不要直接修改上游源码。适配、凭据引用、风险闸门和版本信息全部放在本 Skill。
## Routing

优先使用本 Skill：
- 一个目标需要连续多步点击、输入、选择、滚动与等待。
- 需要利用结构化 DOM/ARIA 状态降低截图开销。
- 用户明确要求 Jev Ultrafast、极速浏览器或 JEV 浏览器自动执行。

继续使用 `browser-harness`：
- 已知单步操作。
- 需要 iframe、Shadow DOM、上传、弹窗、多标签、复杂键盘控件等上游 MVP 尚未完整覆盖的能力。
- 需要视觉判断、截图或精确布局分析。

公开信息能直接 HTTP 获取时，优先使用普通网络读取工具。

## Managed entrypoint

预检：

`python3 <skill-dir>/scripts/managed_runner.py preflight`

执行：

`python3 <skill-dir>/scripts/managed_runner.py run --url '<url>' --goal '<goal>'`

生产 Runner 对每个实际 CLICK、TYPE_TEXT、SELECT、SCROLL 或 WAIT 动作先调用 JEV Central Gateway `/v1/web/pretool`；只有 `allowed: true` 才执行。动作完成后调用 `/v1/web/posttool` 写回收据。review、deny、Gateway 不健康或收据异常均 fail closed。

默认 Capability Lease 只允许初始 URL 的 hostname。确需跨域时显式追加 `--allow-host <hostname>`。页面 freshness 变化时丢弃旧决策、重新观察，再生成新决策。

可用 `--expect-text '<可验证文本>'` 做最终 DOM 文本验收，也可用 `--expect-url-contains '<URL片段>'` 做稳定的 URL 状态验收；两者均可重复传入多个条件。DONE 仍需独立结果证据后才能对外声明任务完成。浏览器自动翻译可能改变 DOM 文本，因此存在明确 URL 状态时优先使用 URL 证据。

默认不允许高风险最终动作。若出现支付、购买、发送、删除、发布、提交、授权、同意、账户或安全相关动作，执行器返回 `needs_review`，由上层 JEV/用户确认后再处理。
## Credentials

决策后端固定使用 TypeSafe 原生 System One：

`https://api.typesafe.ai/v1/systemone`

决策模型默认：

`jev-latest`

TypeSafe 专用凭据只从：

`~/.config/jev-ultrafast/credentials.env`

读取 `TYPESAFE_API_KEY`。该文件权限必须保持 `0600`。

TYPE_TEXT 文本助手优先复用本机已授权的 DeepSeek：

`https://api.deepseek.com/v1`

默认文本模型：

`deepseek-chat`

文本模型凭据通过 `~/.openclaw/.env` 中已有的 `DEEPSEEK_API_KEY` 引用，不复制 secret。若未来显式配置其他受批准的 `TEXT_MODEL_API_KEY`，Runner 可按对应 endpoint 使用。任何密钥都不得打印、复制到日志、写入 Skill 文本或传给浏览器页面。

## Safety and QA

每次运行前必须通过 preflight。页面状态变旧、目标被遮挡、低置信度、高风险动作、缺失凭据或 Provider 错误均 fail closed。

普通动作默认要求 operation top probability >= 0.60；有目标元素时 target top probability >= 0.55。阈值可通过受管环境变量提高，禁止自动降低安全基线。

每个浏览器 mutation 只执行一次。执行后重新观察页面。DONE 仅表示 Jev 选择结束，最终结果仍需独立验证。

不得把此 Skill 当作登录、支付、授权或敏感账户操作的自动批准机制。
## Maintenance

版本升级必须重新执行：

1. 来源与依赖审计。
2. `uv sync --frozen`。
3. `uv run ruff check .`。
4. `uv run pytest`。
5. `uv build`。
6. 更新 `JEV-ACQUISITION.json` 的 commit 与 hash。
7. `jev-skills refresh`。
8. `python3 ~/.codex/codex-router/jev-control/sync_catalog.py`。
9. Canary 后才允许进入 production。

上游已知 MVP 边界包括 Shadow DOM、frame、canvas、上传、新标签、嵌套滚动和任意键盘 widget。遇到这些场景应回退到受 JEV 管理的 `browser-harness`。