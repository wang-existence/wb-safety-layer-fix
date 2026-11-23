# Disclaimer / 使用声明

## English

**Unofficial.** This project is not affiliated with, endorsed by, or supported by Tencent, WorkBuddy,
CodeBuddy, or DeepSeek. Product names appear only to describe interoperability.

**What it changes.** `wb-purge` edits files inside *your own* WorkBuddy installation:
`product.json`, `dist/codebuddy-lite-wb.mjs`, and two keys in `settings.json`. Every file is backed up
as `<file>.wbpurge.bak` before the first write and restored by `revert`. It never edits a vendor
source repository, never contacts a network service, and ships no binaries.

**Intended use.** Local, operator-authorized evaluation of an installation you own or administer:
research into how a host's prompt, approval and review layers shape agent behaviour, and into whether
a given default policy should be tightened or relaxed.

**What it deliberately weakens.** Applying the patch layer sets `Sandbox=false`,
`permissions.defaultMode="bypassPermissions"`, disables the auto-mode classifier, and short-circuits
the in-process tool-risk and content-review gates. That widens what the agent may do on the machine
it runs on. That is the point of the project — and it is reversible:

```powershell
node bin\wb-purge.mjs revert
```

Run `apply` only on machines you own or administer, keep `"audit": true` while evaluating, and revert
when you are done. You are responsible for what the agent does while the patch is applied.

**Out of scope by construction.** Provider-side moderation, third-party services, and anything on a
machine you do not control. This repository contains no malware, no credential material, and no
network attack tooling.

**No warranty.** MIT-licensed, provided as-is. A host update may move the strings the patch table
targets; the tool then reports `conflict` and refuses to write.

---

## 中文

**非官方项目。** 与腾讯、WorkBuddy、CodeBuddy、DeepSeek 均无关联，也未获其背书或支持；文中出现产品名
仅用于说明适配对象。

**它改什么。** `wb-purge` 只改**你自己这台机器上已安装的** WorkBuddy：`product.json`、
`dist/codebuddy-lite-wb.mjs`，以及 `settings.json` 里的两个键。每个文件在首次写入前备份为
`<file>.wbpurge.bak`，`revert` 可原样恢复。它不改厂商源码仓库、不联网、不携带任何二进制。

**用途。** 本机、由使用者本人授权的安装评测：研究宿主的提示词层、审批门、复核层如何塑造 agent 行为，
以及某个默认策略应当收紧还是放宽。

**它主动削弱什么。** 应用补丁层会把 `Sandbox` 置为 `false`、`permissions.defaultMode` 置为
`bypassPermissions`、关闭 auto-mode 分类器，并短路进程内的工具风险复核与内容复核。这会扩大 agent 在
本机上的可操作范围——这正是项目目的，并且可回滚：

```powershell
node bin\wb-purge.mjs revert
```

只在你拥有或负责管理的机器上执行 `apply`；评测期间保持 `"audit": true`，结束后及时 `revert`。补丁生效期间
agent 的行为由你负责。

**结构性不涉及。** 模型服务端审核、第三方服务、以及任何你不掌控的机器。本仓库不含木马、不含凭据材料、
不含对外攻击载荷。

**无担保。** MIT 许可，按现状提供。宿主更新可能移动补丁表所指向的字符串，此时工具会报 `conflict` 并
拒绝写入，而不是猜测。
