---
name: jev-skill-acquirer
description: JEV 能力缺口获取与安全纳编 Skill。当现有 Capability/Skill/Tool 无法完成任务时，按“现有组合→官方 Skill/Plugin/MCP→可信 GitHub→自建 Skill”顺序寻找最小能力包，完成来源审查、权限审查、沙箱/Canary、版本固定、注册和回滚准备后再投入生产。禁止找到仓库后直接执行未知安装脚本。
---

# JEV Skill Acquirer

## Trigger
仅在 JEV 已确认存在 Capability Gap 时触发；有现成 Skill/Tool 能完成时禁止重复安装。

## Acquisition order
1. 现有 Skill + Tool 组合。
2. 官方 Skill / Plugin / MCP / CLI / API。
3. 可信 GitHub 项目。
4. 从已成功的 Codex/Atomic 流程提炼自建 Skill。

## Candidate evaluation
每个候选至少检查：
- 任务匹配度与能力边界
- 来源/维护者/最近维护情况
- 许可证
- 依赖和安装脚本
- 网络、Shell、文件、Secret、root 权限需求
- 平台兼容性
- 已知安全或稳定性问题

Star 数量只能参考，不能作为信任依据。
## Risk gates
- L1：纯 Prompt/SOP、无外部执行，可自动测试注册。
- L2：CLI/API/网络/文件写入/依赖安装，必须隔离测试并使用最小 Capability Lease。
- L3：sudo/root/系统配置/Keychain/未知二进制/大范围删除，必须停在 JEV Hard Gate。

## Promotion pipeline
DISCOVER → FETCH → INSPECT → SANDBOX → FUNCTION TEST → BENCHMARK → PIN → REGISTER → CANARY → PRODUCTION

生产注册必须记录：
- repository/source
- commit SHA 或不可变版本
- content/package hash
- risk level
- tested node/platform
- required secrets（只记录 credential_ref）
- rollback path

## Registration
成功后：
1. 写入唯一 canonical Skill。
2. 用 symlink/projection 投射到需要的 surface。
3. 运行 `jev-skills refresh`。
4. 运行 `python3 ~/.codex/codex-router/jev-control/sync_catalog.py`。
5. 更新 Capability Catalog 与训练/Benchmark记录。

## Failure
候选不满足安全、质量或维护标准时直接淘汰并换下一候选；不得为了完成任务而降低 JEV 安全基线。
