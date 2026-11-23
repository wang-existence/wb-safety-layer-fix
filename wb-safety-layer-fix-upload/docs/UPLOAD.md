# One-click upload / 一键上传

这个包解压后就是一个**完整 git 仓库**（自带 `main` 分支和提交历史），不需要重新 `git init`。

## 最快路径

双击 **`UPLOAD-TO-GITHUB.cmd`**，按提示填写：

1. GitHub 用户名（或组织名）
2. 如果装了 `gh` 且已登录：脚本自动建仓 + 推送，结束
3. 如果没装 `gh`：脚本会自动打开 <https://github.com/new>，你创建一个**空仓库**（不要勾
   README / .gitignore / license），把 Clone URL 粘回终端即可

## 命令行用法

```powershell
# 交互式（推荐）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1

# 全自动：公开仓库
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1 -Owner <你的用户名>

# 私有仓库
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1 -Owner <你的用户名> -Private

# 仓库已经手动建好了
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1 `
  -RemoteUrl https://github.com/<你的用户名>/wb-safety-layer-fix.git

# 只看会执行什么，不改任何文件
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1 -Owner <你的用户名> -DryRun
```

## 脚本做了什么

| 步骤 | 说明 |
| --- | --- |
| 1 | 校验 `.git`、`package.json`、`git` 可用、打印版本与当前 commit |
| 2 | 解析 owner：`-Owner` → `gh api user` → `git config user.name` → 交互输入 |
| 3 | 把仓库里所有 `OWNER` 占位符替换成你的用户名（README ×2、`package.json`、issue 模板） |
| 4 | 有改动就提交一条 `chore: point repository URLs at <owner>` |
| 5 | 建仓并推送：有 `gh` 走 `gh repo create --source . --push`，没有则 `git remote add` + `git push -u origin HEAD:main` |

替换是幂等的：已经指向某个账号的仓库再跑一次，会把占位符步骤跳过（打印
`nothing to rewrite`）。

## 前置条件

- **Git for Windows**（必需）：<https://git-scm.com/download/win>
  - 安装时默认勾选的 *Git Credential Manager* 会在第一次 `push` 时弹出浏览器登录，登录一次以后就不再问。
- **GitHub CLI**（可选，装了更省事）：`winget install GitHub.cli`，然后 `gh auth login`。
- PowerShell 5.1（系统自带）或 PowerShell 7 均可；不需要任何 Node 依赖来上传。
  （运行测试仍需要 Node ≥ 18.20.8。）

## 常见问题

**`push` 报 `remote: Repository not found`** — 仓库没建，或建在了别的账号下。用
`-RemoteUrl` 指定正确地址，或去 <https://github.com/new?name=wb-safety-layer-fix> 建一个空仓库。

**`push` 报 `failed to push some refs` / `non-fast-forward`** — 你建仓时勾了 README，
远程已有一条提交。删掉仓库重建成**空**仓库，或
`git push -u origin HEAD:main --force-with-lease`（会覆盖那条初始提交）。

**推送后 README 里还是 `OWNER`** — 说明第 3 步没跑到（可能你在只读目录里）。手动替换：

```powershell
Get-ChildItem -Recurse -File -Include *.md,*.json,*.yml |
  ForEach-Object { (Get-Content $_.FullName -Raw) -replace 'OWNER', '<你的用户名>' |
  Set-Content $_.FullName -NoNewline -Encoding UTF8 }
git add -A; git commit -m "docs: point repository URLs at <你的用户名>"
```

**Actions 第一次跑失败** — 看 `ci` 的两个 job。`contract` 与 `mod-harness` 必须绿；
`patch round-trip` 在 runner 上没有 WorkBuddy 安装，会自动跳过（这是设计行为）。

**想改仓库名** — 传 `-Repo 新名字`。脚本用它建仓，`OWNER` 替换不受影响。

## 上传之后

- 仓库设置里打开 **Actions**（默认开启），确认 `ci` 跑通。
- `package.json` 里的 `homepage` / `repository` / `bugs` 已经指向你的账号，若改名手动同步。
- 想发版：`git tag v2.0.0 && git push --tags`，GitHub 会自动生成 Release 草稿。
