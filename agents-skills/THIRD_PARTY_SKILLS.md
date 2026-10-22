# 外部技能清单（未收录源码）

以下技能在 Mac 的 `~/.agents/skills` 中存在，但来自第三方上游（HyperFrames / HeyGen、OfficeCLI），且带自身的更新机制与许可，因此本仓库只登记、不收录源码。需要时从上游重新安装。

| 技能 | 来源 / 安装方式 |
| --- | --- |
| hyperframes | HyperFrames（HeyGen），`npx hyperframes skills update` |
| hyperframes-animation | 同上 |
| hyperframes-audio | 同上 |
| hyperframes-cli | 同上 |
| hyperframes-core | 同上 |
| hyperframes-creative | 同上 |
| hyperframes-keyframes | 同上 |
| hyperframes-registry | 同上 |
| faceless-explainer | 同上，`npx hyperframes skills update faceless-explainer` |
| media-use | 同上（HyperFrames 媒体技能，内含上游遥测配置） |
| officecli | OfficeCLI 官方技能，随 officecli 工具安装 |

另：`aoeking-xiezhen-director`、`wechat-miniprogram-builder` 在 Mac 上的版本与仓库 `skills/` 下的版本逐文件一致，未重复收录。

## Phase 1 (2026-10-11) — vendored, pinned, stored in `skills/`

| Skill | Source | Commit |
| --- | --- | --- |
| grill-me, grilling, handoff | https://github.com/mattpocock/skills (skills/productivity/) | 49dd158d1076134a641b33efb035946536778336 |
| grill-with-docs, triage, setup-matt-pocock-skills, domain-modeling | https://github.com/mattpocock/skills (skills/engineering/) | 49dd158d1076134a641b33efb035946536778336 |
| find-skills | https://github.com/vercel-labs/skills (skills/find-skills) | 13e4063a1cf913f5606d57d42ab83a86f5001e04 |

Installed by copy (not `npx skills add`). find-skills is NOT linked into `agents-skills/` because OpenClaw also loads `~/.agents/skills`.

## 未收录（许可不兼容）/ Excluded

| 技能 | 来源 | 原因 |
| --- | --- | --- |
| dbs-ai-check, dbs-hook, dbs-resonate, dbs-xhs-title | https://github.com/dontbesilent2025/dbskill （© dontbesilent） | CC BY-NC 4.0（禁止商用），与本仓库 MIT 许可不兼容，故不在公开版中再分发。请从上游安装：`npx skills add dontbesilent2025/dbskill` |

## 已收录的第三方技能与许可 / Vendored third-party (kept)

| 路径 | 上游 | 许可 |
| --- | --- | --- |
| skills/grill-me, grilling, handoff, grill-with-docs, triage, setup-matt-pocock-skills, domain-modeling | https://github.com/mattpocock/skills | MIT |
| skills/find-skills | https://github.com/vercel-labs/skills | MIT |
| agents-skills/humanizer-zh | https://github.com/op7418/Humanizer-zh （© 歸藏） | MIT（见目录内 LICENSE） |
| agents-skills/jev-browser-ultrafast（封装） | https://github.com/browser-use/jev-ultrafast | MIT |
| image-generation/female-portrait-director | https://github.com/liyue-aigc/female-portrait-director （© 李岳） | MIT（见目录内 LICENSE） |
| image-generation/nuyoah-xiezhen-prompt/upstream | https://github.com/nuyoah-ai-works/nuyoah-xiezhen-prompt （© 南鸢 nuyoah） | MIT（见 upstream/LICENSE） |

上游 MIT 许可原文见 `third_party_licenses/`。
