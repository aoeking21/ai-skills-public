---
name: jev-skill-steward
description: JEV Skill Steward，Mac 本地技能大管家。凡任务可能使用 Codex、ChatGPT Web、OpenClaw 或本机共享 Skill 时，先用本技能统一盘点、路由、依赖检查与风险预检；适用于“用哪个技能”“统一管理技能”“技能健康检查”“大管家”“officecli”等请求。对任何写入、网络、GUI、安装、进程或高风险动作都不得绕过 JEV。
---

# JEV Skill Steward

这是本机所有 AI Skill 的中央编排层。目标不是复制 Skill，而是统一发现、路由、健康检查和风险治理。

## 固定入口

管理命令：

`jev-skills`

中央状态：

- `~/.codex/codex-router/jev-skills-registry.json`
- `~/.codex/codex-router/jev-skills-policy.json`
- `~/.codex/codex-router/jev-control/capabilities.json`：Capability Catalog
- `~/.codex/codex-router/jev-control/agents.json`：Agent Registry
- `~/.codex/codex-router/jev-control/nodes.json`：Node Registry
- `~/.codex/codex-router/jev-control/routing.json`：Shortest Valid Path 调度规则
- `~/.codex/codex-router/jev-control/training/`：实战训练/验收记录

中央实现：

`~/.local/share/jev-central-gateway/skill-steward/jev_skills.py`

## 前置需求澄清闸门

在任何会产生实质执行、创作、修改、安装、配置或长期影响的任务开始前，先判断是否存在会改变方案的关键歧义。若存在，必须读取并遵循 `jev-task-clarifier`；优先使用当前对话和项目上下文，不得重复询问已知信息。任务已清晰、只是事实/状态查询，或用户明确说“直接做/不要问”时，跳过澄清并立即执行。

## 必须执行的路由流程

1. 运行 `jev-skills resolve "<用户真实意图>"`，优先复用现有 Skill。
2. 读取 Capability Catalog 中对应条目，再结合 Agent Registry 与 Node Registry 选择 Skill + Executor + Model + Node。
3. 一个 Skill/Tool 能独立完成时走 Direct Path；不要为了“充分利用”而强行套 Agent。
4. 大量多步、批量、浏览器 SOP、MCP/工具链任务优先交给对应的 JEV 执行平面与领域 Skill。
5. 高难代码、系统故障、架构、非标准诊断优先交给 Codex；内容/研究任务使用最合适的强模型或专业 Skill。
6. 选择满足质量要求的最小团队和最短合法路径；节点离线时只降级受该节点约束的能力。
7. 若无合适 Skill：先组合现有 Tool；仍缺能力时必须读取并遵循 `jev-skill-acquirer`，按“官方 Skill/Plugin/MCP → 可信 GitHub → 自建 Skill”获取最小能力包。外部能力必须审查、沙箱/Canary、固定版本后才能注册。
8. 从返回的 `canonical_path` 完整读取 `SKILL.md`；不得凭记忆虚构 Skill。
9. Skill 安装、启用、禁用或能力映射变化后，运行 `jev-skills refresh`，再运行 `python3 ~/.codex/codex-router/jev-control/sync_catalog.py` 保持 Capability Catalog 同步；若 Desktop-05 管理通道可用，再运行 `zsh ~/.local/bin/jev-sync-control` 投射中央账本。远端不可用时不得阻塞本地 Registry 更新，只标记 sync pending。
10. Skill 缺失或依赖异常时运行 `jev-skills doctor`；执行结果必须经过与任务风险相称的 QA。
## 视觉生成强制前置

任何最终交付包含创建、编辑、修复、重构或生成图片的任务，必须先读取并执行 `jev-visual-control-plane`。先运行 `jev-skills visual compile "<用户真实图像任务>"`；存在本轮真人参考图时增加 `--reference-image`。只有返回 `PRE_GENERATION_GATE_PASS` 才进入图像生成器。

视觉路由采用组合式结构：一个 primary skill + 零到多个 support skill + mandatory modules。显式 `$vsc / @vsc / VSC / 严格模式` 时必须让 `vsc` 位于 skill_load_order 首位。不得把底层 `imagegen` 直接命中当作已完成 JEV 视觉路由。

## JEV 风险治理

Codex / ChatGPT Web 已有 JEV 强制 Hook 时，继续使用现有 PreTool / PostTool 链，禁止旁路。

OpenClaw 或其他尚未证明存在硬 Hook 的本地代理，在执行写入、网络、GUI、安装、进程控制或其他有副作用动作前，先调用：

`jev-skills guard --skill <skill> --tool <tool-name> --args-json '<json>' --session <stable-session>`

只有返回 `allowed: true` 才继续。保存返回的 `decisionId` 和 `sessionId`。执行完成后调用：

`jev-skills post --decision-id <id> --session-id <id>`

执行失败则增加 `--error`。

若 JEV 返回 review required、deny、unavailable 或状态不明确：停止执行，不得自动绕过、改走未经审批的工具路径或降低安全级别。

## officecli

Office 文档任务优先使用 `officecli` Skill。

本机 binary 固定检查：

`officecli --version`

支持 `.docx / .xlsx / .pptx` 的创建、读取、分析、校对、修改与验证。对文件修改仍属于有副作用动作，必须保留 JEV 管控。

## 管理命令

- `jev-skills refresh`：重新扫描并生成中央注册表。
- `jev-skills status`：查看总体状态。
- `jev-skills doctor`：检查 JEV、Skill 断链、重复实体和 officecli。
- `jev-skills list`：完整 Skill 清单。
- `jev-skills resolve "<任务>"`：按意图选择 Skill。
- `jev-skills show <name>`：查看单个 Skill。
- `jev-skills disable <name>`：从 Steward 自动路由中禁用。
- `jev-skills enable <name>`：恢复 Steward 自动路由。

注意：enable/disable 是 JEV Steward 的“路由策略”，不是删除 Skill 文件。

## 单一事实源

优先使用注册表给出的 `canonical_path`。共享 Skill 应尽量只有一份实体，通过符号链接供 Codex / OpenClaw / 其他代理使用，避免版本漂移。
