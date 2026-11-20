# AI Skills Public

aoeking21 的 AI Skills 合集：图像生成、提示词工程与 Agent 工作流的技能与规则。

> **English:** A curated collection of AI agent skills and prompts (image generation, prompt engineering, agent workflows) for Codex / Claude Code / other `SKILL.md`-compatible agents. Most content is in Chinese.

## 目录结构 / Structure

| 目录 | 内容 |
| --- | --- |
| `skills/` | 标准 Agent Skill（含 `SKILL.md` / manifest），可用 `npx skills add` 安装 |
| `agents-skills/` | JEV、RA 等工作流技能 |
| `image-generation/` | 人像 / 写真提示词导演类技能 |
| `prompt-engineering/` | 提示词工程资料 |
| `codex/` | Codex 全局规则示例 `AGENTS.md` |
| `docs/` | 技能规则与设计文档 |
| `scripts/` | 技能校验脚本 |

## 使用 / Usage

```bash
# 安装单个技能（示例）
npx skills add aoeking21/ai-skills-public --skill aoeking-xiezhen-director -g -a codex -y
# 或直接复制某个技能目录到 ~/.agents/skills/ 或 ~/.codex/skills/
python3 scripts/validate_agent_skills.py   # 校验技能结构
```

注：部分技能依赖作者本机工具（如 `~/.local/bin/...`），路径仅作参考，需按自己环境调整。

## 许可 / License

本仓库自有内容采用 [MIT License](LICENSE)。第三方技能保留各自的上游许可与署名，见 [agents-skills/THIRD_PARTY_SKILLS.md](agents-skills/THIRD_PARTY_SKILLS.md)。
Original content is MIT-licensed; vendored third-party skills keep their upstream licenses and attribution.

<!-- single-source-of-truth:start -->

## 统一规则源（Mac / 云电脑 / Grok Bot）

本仓库是我全部 AI 规则与技能的唯一正本，Mac、云电脑和 Grok Bot 都从这里同步，改一处即三处生效。

- `codex/AGENTS.md`：Codex 全局工作规则，对应 Mac 上的 `~/.codex/AGENTS.md`。
- `agents-skills/`：Mac `~/.agents/skills` 里的 JEV、RA 等个人技能（DBS 系列因 CC BY-NC 许可未收录，见第三方清单）（已展开软链接，排除缓存与密钥类文件）。
- `agents-skills/THIRD_PARTY_SKILLS.md`：第三方技能清单，只登记来源，不收录源码。
- `docs/SKILLS-RULES.md`：技能统一规则（正本、单向链接、第三方收录、find-skills/triage 特别规则）。
- `skills/`：可独立安装、带 manifest 的标准 Agent Skill，通过 `npx skills add` 分发。

同步方向：先改本仓库并合并到 `main`，各端再拉取更新；不要在某一端单独修改后不回写。

<!-- single-source-of-truth:end -->

## 图像生成

### female-portrait-director

女性人像提示词导演 Skill：锁定用户明确参数，通过单一路由组织人物、动作、服装、场景、镜头、光线与滤镜，生成完整、可复制的摄影导演式提示词；支持已授权成年人物或产品参考主体的保留工作流。

- [进入模块](image-generation/female-portrait-director/README_zh.md)
- [Skill 入口](image-generation/female-portrait-director/SKILL.md)
- [独立仓库](https://github.com/aoeking21/female-portrait-director)
- 上游来源：[liyue-aigc/female-portrait-director](https://github.com/liyue-aigc/female-portrait-director)

<!-- nuyoah-xiezhen-prompt:start -->

### nuyoah-xiezhen-prompt

南鸢写真提示词 Skill 的锁定上游镜像，以及面向长期人物项目的 aoeking 增强层。

- [模块入口](image-generation/nuyoah-xiezhen-prompt/README.md)
- [上游原版](image-generation/nuyoah-xiezhen-prompt/upstream/SKILL.md)
- [aoeking 增强版](image-generation/nuyoah-xiezhen-prompt/aoeking-enhanced/SKILL.md)
- 上游来源：[nuyoah-ai-works/nuyoah-xiezhen-prompt](https://github.com/nuyoah-ai-works/nuyoah-xiezhen-prompt)

<!-- nuyoah-xiezhen-prompt:end -->

<!-- callable-agent-skill:start -->

### aoeking-xiezhen-director（可安装 Agent Skill）

面向授权成年人物长期写真项目的标准 Agent Skill。支持人物 DNA 锁定、真实摄影事件、身体比例连续性、多张独立变体和失败成片诊断。

- [标准 Skill 入口](skills/aoeking-xiezhen-director/SKILL.md)
- [安装与调用说明](skills/aoeking-xiezhen-director/README.md)
- Codex 全局安装：`npx skills add aoeking21/ai-skills-public --skill aoeking-xiezhen-director -g -a codex -y`
- 临时调用：`npx skills use aoeking21/ai-skills-public --skill aoeking-xiezhen-director --agent codex`

<!-- callable-agent-skill:end -->

<!-- pose-gallery-director:start -->

### pose-gallery-director（可安装 Agent Skill）

姿势图库导演 Skill。按中文关键词检索姿势、服装、人像参考图，并把选中的姿势接进写真摄影工作流：身份锁定之后、构图之前。图库图片不随本仓库分发，按需单张拉取；默认只出安全姿势。

- [标准 Skill 入口](skills/pose-gallery-director/SKILL.md)
- [安装与调用说明](skills/pose-gallery-director/README.md)
- [融合设计](docs/photography-pose-fusion-v1.0.md)
- Codex 全局安装：`npx skills add aoeking21/ai-skills-public --skill pose-gallery-director -g -a codex -y`
- 图库来源：日本原版 Gia（@giaaibusi）ai-pose-gallery，中文镜像 [anhao/ai-pose-gallery-zh](https://github.com/anhao/ai-pose-gallery-zh)

<!-- pose-gallery-director:end -->

## 应用开发

<!-- wechat-miniprogram-builder:start -->

### wechat-miniprogram-builder（可安装 Agent Skill）

面向微信小程序全生命周期的标准 Agent Skill。支持选题与 MVP、主体与类目、原生开发、云与 AI 安全、审核修复、上线检查、合规增长和产品组合，并对易变化的平台规则执行官方运行时核验。

- [标准 Skill 入口](skills/wechat-miniprogram-builder/SKILL.md)
- [安装与调用说明](skills/wechat-miniprogram-builder/README.md)
- Codex 全局安装：`npx skills add aoeking21/ai-skills-public --skill wechat-miniprogram-builder -g -a codex -y`
- 临时调用：`npx skills use aoeking21/ai-skills-public --skill wechat-miniprogram-builder --agent codex`
- 上游来源：[chenjin-cmd/wechat-miniprogram-builder](https://github.com/chenjin-cmd/wechat-miniprogram-builder)

<!-- wechat-miniprogram-builder:end -->

## 目录结构

```text
ai-skills/
├── image-generation/
│   ├── female-portrait-director/
│   └── nuyoah-xiezhen-prompt/
├── codex/                # Codex 全局规则 AGENTS.md
├── agents-skills/        # Mac ~/.agents/skills 个人技能
├── skills/
│   ├── aoeking-xiezhen-director/
│   ├── pose-gallery-director/
│   └── wechat-miniprogram-builder/
├── prompt-engineering/
└── docs/
```

## 许可与署名

- `female-portrait-director` 保留原项目作者、许可证、免责声明和版本信息。该模块使用 MIT License。
- `nuyoah-xiezhen-prompt/upstream` 保留南鸢 nuyoah 的原始版权、来源、版本清单和 MIT License；`aoeking-enhanced` 作为独立增强层维护。
- `skills/aoeking-xiezhen-director` 是可独立安装的标准包，保留上游 MIT 许可与来源声明。
- `skills/wechat-miniprogram-builder` 派生自 `chenjin-cmd/wechat-miniprogram-builder`，保留上游 MIT 许可与来源声明。
