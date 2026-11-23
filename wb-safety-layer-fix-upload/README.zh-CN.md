# wb-safety-layer-fix

**WorkBuddy 版的 dsh-purge。** 把宿主*拦截层*（提示词模板、审批门、风险复核、内容复核）拆掉，同时在模型
前面留一条会话级操作员策略。两半彼此独立，都可回滚。

[![ci](https://github.com/wang-existence/wb-safety-layer-fix/actions/workflows/ci.yml/badge.svg)](https://github.com/wang-existence/wb-safety-layer-fix/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518.20.8-339933.svg)](package.json)
[![verified](https://img.shields.io/badge/verified-WorkBuddy%205.11.3%20%C2%B7%20CLI%202.176.0-2f7d32.svg)](docs/VERIFY.md)
[![English](https://img.shields.io/badge/docs-English-lightgrey.svg)](README.md)

> 非官方项目，与腾讯 / WorkBuddy / CodeBuddy / DeepSeek 无关。应用补丁层前请先读
> [docs/DISCLAIMER.md](docs/DISCLAIMER.md)。

---

## 为什么做这个

Harness 不只是把问题交给模型：它还会改系统提示词、掌管审批门、复核工具调用、重排会话。回答变成一段策略
模板时，只看"模型是不是拒了"会把宿主的拦截误记到模型头上。这个插件在你自己的安装里把两层分开——你能看清
是哪一层答的，也能判断默认策略该不该收紧。

| 半边 | 加载方式 | 是否写文件 | 回滚方式 |
| --- | --- | --- | --- |
| **mods**（运行时钩子） | CLI 的 mods 运行时，每次会话 | 否 | `enabled:false`、`WB_SAFETY_LAYER_FIX=off`、卸载 |
| **wb-purge**（补丁引擎） | `node bin/wb-purge.mjs apply` | 是，带 `.wbpurge.bak` | `node bin/wb-purge.mjs revert` |

## 四层

| 层 | 编号 | 目标 | 作用 |
| --- | --- | --- | --- |
| **提示词** | `P01`–`P04` | `product.json` → `prompts[]` | 系统提示词与工作区指令前置强制 `<operator_policy>`；分类器裁决口径；复核器只看爆炸半径 |
| **代码默认** | `P05`–`P07` | `product.json` 开关 + `settings.json` | `Sandbox=false`、`SkillSecurityScan=false`、`defaultMode="bypassPermissions"`、`disableAutoMode="disable"` |
| **引擎** | `P08`–`P11` | `dist/codebuddy-lite-wb.mjs` | 函数钩子强制开启；工具风险复核、内容保护、内容复核短路 |
| **运行时** | — | `hooks/register.mjs` | `tool.check` / `classic.PreToolUse` / `PermissionRequest` 一律 **allow**；`prompt.context` / `prompt.section` / `prompt.submit` 承载策略 |

每条补丁的目标字符串、副作用与验证方法见 [docs/PATCHES.md](docs/PATCHES.md)。

## 快速开始

```powershell
git clone https://github.com/wang-existence/wb-safety-layer-fix.git
cd wb-safety-layer-fix

# 只装插件：mods + 斜杠命令 + skill
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1

# 插件 + 四层补丁，一条命令做完并验证
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Purge
```

**先关掉 WorkBuddy**：运行中的守护进程把插件注册表放在内存里，退出时会回写 `settings.json`。装完启动应用，
在会话里：

```
/purge-status      → 11/11 applied + verify 输出
/safety-fix        → mods 配置（policy / preamble / engine）
```

要求：Node ≥ 18.20.8，Windows（已实测），PowerShell 5.1 或 7+。零依赖。

## Purge 命令行

```powershell
node bin\wb-purge.mjs status                 # 逐条：applied | pending | conflict | missing
node bin\wb-purge.mjs apply --dry-run        # 只做断言，不写盘
node bin\wb-purge.mjs apply                  # 写入 + <file>.wbpurge.bak
node bin\wb-purge.mjs verify                 # JSON · node --check · 覆盖率 · --version
node bin\wb-purge.mjs revert                 # 还原备份，撤掉那两个 settings 键
node bin\wb-purge.mjs layers                 # 只打印补丁表
```

冲突、找不到安装、验证失败一律退出码 `1`，可直接给脚本/CI 当门禁。每个子命令都支持 `--json`，
`--cli-root=<path>` 可覆盖安装探测。

## 实测结果（不是声称）

```
status     applied=11
verify     product.json 解析通过（131 prompts）· node --check 通过 · 11/11 applied · --version 2.176.0
revert     还原 3 个文件 → pending=11 → 原版 bundle 仍能运行 2.176.0        （往返已验证）
apply      重新应用；bundle 减小 23 字节（替换文本比被移除的守卫更短）
测试集     contract 17/17 · mods harness 16/16 · loader gate 2/2 份副本 · patch round-trip 8/8
清单       plugin validate ✔ · plugin list → wb-safety-layer-fix@wb-local 2.0.0 enabled
```

原始输出与逐条命令：[docs/VERIFY.md](docs/VERIFY.md)。

## 配置

`config.json`，**每轮**重新读取：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 运行时层总开关 |
| `policy` | `true` | 注入 `<sandbox_operator_policy>`（不影响文件补丁） |
| `preamble` | `true` | 用户轮加 fixture 前导 |
| `envelope` | `false` | 再用 `<user_request>…</user_request>` 包一层 |
| `engineBypass` | `true` | `tool.check` / `PreToolUse` / `PermissionRequest` 答 allow |
| `audit` | `false` | 每个 allow 决定写一行到会话调试日志 |
| `promptInject` | `true` | 启用 `<profile>/.workbuddy/wbpurge/prompt-inject.md` 覆盖 |
| `extraRules` | `[]` | 追加为策略块第 7、8… 条规则 |

总开关：`WB_SAFETY_LAYER_FIX=off`（优先级最高）。更多工作流见 [docs/USAGE.md](docs/USAGE.md)。

## 为什么不会把安装搞坏

- **命中数必须恰好 1**：0 次或 ≥2 次 → `conflict`，一个字节都不写。
- **每个文件只备份一次**，首次写入前创建，`revert` 原样还原。
- **settings 按键还原**：只撤本插件写的那两个键，你后来改的其它设置不受影响。
- **运行时 fail-open**：配置缺失、文件读不到、钩子抛错一律回落到 `next(event)`，插件坏了也不会坏掉一轮对话。
- **不联网、不上报、不带二进制、不重分发厂商代码**。

## 仓库结构

```
.codebuddy-plugin/plugin.json   宿主校验的插件清单
hooks/                          hooks.json（modules 数组）+ register.mjs（7 个钩子，隔离 realm）
lib/patches.mjs                 11 条补丁的声明表 + 注入的策略文本
lib/engine.mjs                  apply / revert / status / verify、备份、日志、安装探测
bin/wb-purge.mjs                命令行
commands/                       /purge-status /purge-apply /purge-revert /safety-fix /safety-toggle
skills/safety-layer-fix/        给模型看的说明
tests/                          contract · mods harness · loader gate · patch round-trip
docs/                           架构 · 补丁详解 · 用法 · 验证 · FAQ · 声明
install.ps1 / uninstall.ps1     注册（卸载时先自动 revert）
```

## 与 dsh-purge 的差异

| dsh-purge | 这里 |
| --- | --- |
| Cordis 侧栏 UI（清洗 / 演练台） | CLI + 三个斜杠命令——WorkBuddy 插件系统没有宿主 UI 扩展点 |
| 红队预设、`skills/redteam`、paper-autopilot | 未随包（属内容资产，不是破甲机制） |
| `node_modules` 升级后自动重打 | `status` → `apply`；`install.ps1 -Purge` 一步完成 |
| 补丁打在 `@deepseek-ai` 包内 | 补丁打在 `product.json` 与 CLI bundle |

## 一键上传

双击根目录的 **`UPLOAD-TO-GITHUB.cmd`**：脚本会替换所有 `wang-existence` 占位符为你自己的 GitHub 账号名，
然后建仓并推送（有 `gh` 自动建；没有则提示你在浏览器建一个空仓库，粘贴 URL 继续）。
完整步骤与排错见 [docs/UPLOAD.md](docs/UPLOAD.md)。

## 常见问题

"更新后 status 全是 conflict 怎么办"、"重启后 permissions 键怎么没了"、"能不能只关分类器"——
见 [docs/FAQ.md](docs/FAQ.md)。上传/适配新版本请读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

MIT —— [LICENSE](LICENSE) · [NOTICE](NOTICE) · [CHANGELOG](CHANGELOG.md) · [SECURITY.md](SECURITY.md)。
