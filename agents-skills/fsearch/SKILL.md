---
name: fsearch
description: "Use when the user wants to find files by name anywhere on the Mac, search file contents across folders, or ask 找文件 / 搜文件 / 全盘搜索 / 在哪个文件里 / find file / search inside files. Prefer the local fsearch daemon with --json; fall back to rg/fd/find if the daemon is down. Not for in-repo symbol lookup (use project tools / jev-find-code)."
---

# fsearch — 本机全盘文件索引搜索

本地 Rust 守护进程，索引文件名与（可索引类型的）内容。**不联网**。二进制：`~/.local/bin/fsearch`。LaunchAgent：`mt.nd.fsearch`。

## 何时用

- 按文件名在整台 Mac 上定位（不只当前仓库）
- 跨目录搜文件内容（`grep:` / `re:`）
- 用户说：找文件、搜文件、全盘搜索、在哪个文件里、find file、search inside files

仓库内按符号/候选路径做语义导航 → 用 `jev-find-code`，不要用本 skill 替代。

## Agent 用法（优先 JSON）

```bash
fsearch status
fsearch 'AGENTS.md limit:20' --json
fsearch 'AGENTS.md in:~/.codex limit:20' --json
fsearch 'readme in:~/Developer ext:md limit:20' --json
fsearch 'grep:Golden Baseline ext:md in:~/.codex limit:10' --json
fsearch 're:^# 工作原则 ext:md in:~/.codex limit:5' --json
```

常用过滤器：`ext:` `type:`/`kind:` `in:` `size:` `mtime:` `path:` `grep:` `re:` `sym:` `limit:`。

stdio JSON 行协议：`fsearch stdio`（适合脚本）。

## 守护进程与失败回退

```bash
fsearch status
# LaunchAgent 异常时可：
launchctl kickstart -k "gui/$(id -u)/mt.nd.fsearch"
```

若 `fsearch` 不可用或 status 失败：回退 `rg` / `fd` / `find`（范围尽量收窄），并告知用户。

## Full Disk Access（FDA）

未授权时 `status` 里 `full_disk_access:false`，会跳过受保护目录（Mail、部分系统库等）。

用户手动：系统设置 → 隐私与安全性 → 完全磁盘访问权限 → 加入 `~/.local/bin/fsearch`，然后：

```bash
launchctl kickstart -k "gui/$(id -u)/mt.nd.fsearch"
```

## 注意

- 首次索引约 20s+；之后查询通常毫秒级。
- 不要把大量原始 hits 整段粘进回复；摘要路径与命中行即可。
- 不修改、不删除文件；本工具只读搜索。
