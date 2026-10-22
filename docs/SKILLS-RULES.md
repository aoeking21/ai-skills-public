# 技能统一规则（SKILLS-RULES）

本仓库 `~/ai-skills`（GitHub: aoeking21/ai-skills-public）是全部 AI 技能的唯一正本。

## 1. 唯一正本
- 技能的真实目录只放在 `~/ai-skills/skills/<名字>/`。
- 各端不得单独修改技能；改动先进本仓库，再由各端通过链接/同步生效。

## 2. 单向链接（正本 → 各端）
| 端 | 目录 | 方式 |
| --- | --- | --- |
| Codex | `~/.codex/skills/<名字>` | 软链接 → `~/ai-skills/skills/<名字>` |
| Claude | `~/.claude/skills/<名字>` | 同上 |
| OpenClaw | `~/.openclaw/skills/<名字>` | 同上 |
| U-Claw / 小龙虾 | `~/.uclaw/data/.openclaw/skills/<名字>` | 同上，并加入 `openclaw.json` 的 `agents.defaults.skills` 白名单才启用 |
| ~/.agents | `~/.agents/skills` → `~/ai-skills/agents-skills`，其中新技能用相对链接 `../skills/<名字>` | 注意：OpenClaw 也会加载 `~/.agents/skills` |
| Grok Bot | box `/home/box/agent-data/workflows/<名字>` | 从本仓库 GitHub 拉取同步 |

- 禁止端与端之间互相链接（例如 codex → claude）。
- 存量技能的迁移在第 2 阶段进行；每日检查脚本 `scripts/check_skills.py` 会列出未迁移项、断链和版本冲突。

## 3. 第三方技能
- 固定到具体 commit，在 `agents-skills/THIRD_PARTY_SKILLS.md` 登记来源与 commit。
- 用拷贝方式收录到 `skills/`；不要用 `npx skills add -g`（它会写 `~/.agents/skills` 并自动给各 AI 目录建链接、默认上报遥测）。
- 收录前必须完整阅读 SKILL.md，检查 shell 命令、联网、凭据访问、过宽触发词。

## 4. 特别规则
- **find-skills：只推荐、不安装。** 只能列出候选技能及来源；不得执行 `npx skills add`（尤其 `-g -y`）。要安装须经用户同意并走本仓库流程。只链接给 Codex 和 Claude。
- **triage：仅在用户明确要求时使用。** 需用户指定工单系统（推荐先用本地 markdown），并已在该仓库运行 `setup-matt-pocock-skills`。对外部工单系统的评论/关闭/打标签都需用户确认。小龙虾不启用 triage 和 setup-matt-pocock-skills。
- 提交中不得包含密钥、Token、Cookie、缓存。
