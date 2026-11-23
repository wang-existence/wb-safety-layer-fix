#Requires -Version 5.1
<#
.SYNOPSIS
    One-shot GitHub upload for wb-safety-layer-fix.

.DESCRIPTION
    1. validates that this folder really is the git repository
    2. resolves the GitHub owner (argument -> git config -> prompt)
    3. rewrites the OWNER placeholder in README / package.json / issue templates
    4. commits that metadata change
    5. creates the repository and pushes: gh when available, otherwise
       `git remote add` + `git push` (browser + Git Credential Manager)

.PARAMETER Owner
    GitHub user or organisation. Prompted for when omitted.

.PARAMETER Repo
    Repository name. Defaults to wb-safety-layer-fix.

.PARAMETER Private
    Create a private repository instead of a public one.

.PARAMETER RemoteUrl
    Push to this existing URL instead of creating a repository.

.PARAMETER Yes
    Do not prompt; requires -Owner.

.PARAMETER DryRun
    Print every command that would run; change nothing.

.EXAMPLE
    .\scripts\push-to-github.ps1

.EXAMPLE
    .\scripts\push-to-github.ps1 -Owner octocat -Private

.EXAMPLE
    .\scripts\push-to-github.ps1 -RemoteUrl https://github.com/octocat/wb-safety-layer-fix.git

.EXAMPLE
    .\scripts\push-to-github.ps1 -Owner octocat -DryRun
#>
[CmdletBinding()]
param(
    [string]$Owner,
    [string]$Repo = 'wb-safety-layer-fix',
    [switch]$Private,
    [string]$RemoteUrl,
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Write-Note([string]$Text) { Write-Host "    $Text" -ForegroundColor Yellow }
function Write-Dim([string]$Text) { Write-Host "    $Text" -ForegroundColor DarkGray }

# Native calls are captured under a local 'Continue' policy: in Windows PowerShell 5.1
# every stderr line from a native tool becomes a terminating error under 'Stop'.
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Exe @Arguments 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{
        Code = $code
        Text = (($output | ForEach-Object { "$_" }) -join "`n").Trim()
    }
}

function Invoke-Streamed {
    param([string]$Exe, [string[]]$Arguments)
    if ($DryRun) {
        Write-Dim ("[dry-run] {0} {1}" -f $Exe, ($Arguments -join ' '))
        return 0
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @Arguments
        return $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
}

# ---------------------------------------------------------------- locate repo

if (Test-Path (Join-Path $PSScriptRoot 'package.json')) {
    $Root = $PSScriptRoot
} else {
    $Root = Split-Path -Parent $PSScriptRoot
}
Set-Location -LiteralPath $Root
Write-Step "repository  $Root"

if (-not (Test-Path (Join-Path $Root '.git'))) {
    throw 'This folder is not a git repository (no .git). Unzip the package, then run this script.'
}
if (-not (Test-Path (Join-Path $Root 'package.json'))) {
    throw 'package.json is missing - run this script from inside the wb-safety-layer-fix repository.'
}

$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    throw 'git was not found in PATH. Install Git for Windows first: https://git-scm.com/download/win'
}
$gitVersion = Invoke-Native 'git' @('--version')
if ($gitVersion.Code -ne 0) { throw "git is not usable: $($gitVersion.Text)" }
Write-Ok $gitVersion.Text

$pkg = [System.IO.File]::ReadAllText((Join-Path $Root 'package.json')) | ConvertFrom-Json
Write-Ok ("plugin {0} v{1}" -f $pkg.name, $pkg.version)

$head = Invoke-Native 'git' @('rev-parse', '--short', 'HEAD')
$branch = Invoke-Native 'git' @('rev-parse', '--abbrev-ref', 'HEAD')
Write-Ok ("branch {0} @ {1}" -f $branch.Text, $head.Text)

$status = Invoke-Native 'git' @('status', '--porcelain')
if ($status.Text) {
    Write-Note 'working tree has local changes - they will be added to the metadata commit'
} else {
    Write-Ok 'working tree clean'
}

# --------------------------------------------------------------- resolve owner

if (-not $Owner) {
    $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($ghCmd) {
        $api = Invoke-Native 'gh' @('api', 'user', '--jq', '.login')
        if ($api.Code -eq 0 -and $api.Text) { $Owner = $api.Text }
    }
}
if (-not $Owner) {
    $configured = Invoke-Native 'git' @('config', 'user.name')
    $suggested = ''
    if ($configured.Code -eq 0 -and $configured.Text) {
        $suggested = ($configured.Text -replace '[^A-Za-z0-9-]', '')
    }
    if ($Yes) {
        if (-not $suggested) { throw 'Owner unknown. Pass -Owner <github-user>.' }
        $Owner = $suggested
    } else {
        Write-Step 'GitHub owner'
        $prompt = '    GitHub user or organisation'
        if ($suggested) { $prompt += " [$suggested]" }
        $answer = Read-Host $prompt
        if ($answer) { $Owner = $answer } else { $Owner = $suggested }
    }
}
if (-not $Owner) { throw 'No owner given.' }
$Owner = $Owner.Trim()
if ($Owner -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$') {
    throw "Owner '$Owner' does not look like a GitHub account name."
}
$visibilityText = if ($Private) { 'private' } else { 'public' }
Write-Ok ("owner {0} / repo {1} ({2})" -f $Owner, $Repo, $visibilityText)

# ------------------------------------------------- replace OWNER placeholders
# Only README / package.json / .github templates. The uploader and the guides quote the
# literal placeholder in examples, so they are left alone.

$targets = @('README.md', 'README.zh-CN.md', 'package.json')
$githubDir = Join-Path $Root '.github'
if (Test-Path -LiteralPath $githubDir) {
    Get-ChildItem -LiteralPath $githubDir -Recurse -File -Include '*.yml', '*.md' -ErrorAction SilentlyContinue |
        ForEach-Object { $targets += $_.FullName }
}

Write-Step 'rewriting OWNER placeholders'
$rewritten = 0
foreach ($target in $targets) {
    $path = if ([System.IO.Path]::IsPathRooted($target)) { $target } else { Join-Path $Root $target }
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $text = [System.IO.File]::ReadAllText($path)
    if ($text -notmatch 'OWNER') { continue }
    $updated = $text -replace 'OWNER', $Owner
    if ($updated -eq $text) { continue }
    if (-not $DryRun) { [System.IO.File]::WriteAllText($path, $updated, $Utf8NoBom) }
    Write-Ok ($path.Substring($Root.Length).TrimStart('\', '/'))
    $rewritten++
}
if ($rewritten -eq 0) { Write-Ok 'nothing to rewrite (already pointed at an account)' }

# --------------------------------------------------------------- metadata commit

if ($rewritten -gt 0 -or $status.Text) {
    Write-Step 'committing the metadata change'
    Invoke-Streamed 'git' @('add', '-A') | Out-Null
    $commit = Invoke-Streamed 'git' @('commit', '-m', "chore: point repository URLs at $Owner")
    if ($commit -ne 0) { Write-Note 'nothing to commit (already committed)' }
}

# ---------------------------------------------------------------------- remote

$hasGh = [bool](Get-Command gh -ErrorAction SilentlyContinue)
$probe = Invoke-Native 'git' @('remote', 'get-url', 'origin')
$existingRemote = if ($probe.Code -eq 0 -and $probe.Text) { $probe.Text } else { $null }

if ($RemoteUrl) {
    Write-Step "remote  $RemoteUrl"
    if ($existingRemote) {
        if ($existingRemote -ne $RemoteUrl) {
            Invoke-Streamed 'git' @('remote', 'set-url', 'origin', $RemoteUrl) | Out-Null
            Write-Ok "origin -> $RemoteUrl"
        } else {
            Write-Ok 'origin already points there'
        }
    } else {
        Invoke-Streamed 'git' @('remote', 'add', 'origin', $RemoteUrl) | Out-Null
    }
    Write-Step 'pushing'
    $push = Invoke-Streamed 'git' @('push', '-u', 'origin', 'HEAD:main')
    if ($push -ne 0) {
        Write-Host ''
        Write-Note 'push failed. Create the repository empty first, then retry this command:'
        Write-Host "    https://github.com/new?name=$Repo" -ForegroundColor Yellow
        exit 1
    }
    Write-Ok "pushed - https://github.com/$Owner/$Repo"
    Write-Host ''
    Write-Host 'done.' -ForegroundColor Green
    return
}

if ($hasGh) {
    $auth = Invoke-Native 'gh' @('auth', 'status')
    if ($auth.Code -eq 0) {
        $flag = if ($Private) { '--private' } else { '--public' }
        Write-Step "creating repository with gh ($flag)"
        $create = Invoke-Streamed 'gh' @('repo', 'create', "$Owner/$Repo", $flag, '--source', '.', '--remote', 'origin', '--push')
        if ($create -eq 0) {
            Write-Ok "pushed - https://github.com/$Owner/$Repo"
            Write-Host ''
            Write-Host 'done.' -ForegroundColor Green
            return
        }
        Write-Note 'gh repo create failed (repository may exist) - falling back to git push'
    } else {
        Write-Note 'gh is installed but not logged in (gh auth login) - falling back to git push'
    }
}

$defaultUrl = "https://github.com/$Owner/$Repo.git"
if (-not $existingRemote) {
    if ($DryRun) {
        Invoke-Streamed 'git' @('remote', 'add', 'origin', $defaultUrl) | Out-Null
    } else {
        Write-Host ''
        Write-Note 'Create an EMPTY repository (no README, no .gitignore), then paste its URL.'
        Write-Host "    https://github.com/new?name=$Repo" -ForegroundColor Yellow
        Start-Process "https://github.com/new?name=$Repo"
        $answer = Read-Host "    remote URL [$defaultUrl]"
        if (-not $answer) { $answer = $defaultUrl }
        $existingRemote = $answer
        Invoke-Streamed 'git' @('remote', 'add', 'origin', $answer) | Out-Null
    }
}

Write-Step 'pushing'
$push = Invoke-Streamed 'git' @('push', '-u', 'origin', 'HEAD:main')
if ($push -ne 0) {
    Write-Host ''
    Write-Note 'push failed. Usual causes:'
    Write-Host "    - repository missing -> https://github.com/new?name=$Repo" -ForegroundColor Yellow
    Write-Host '    - repository has an initial commit (README box ticked) -> recreate it empty, or:' -ForegroundColor Yellow
    Write-Host '      git push -u origin HEAD:main --force-with-lease' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host 'done.' -ForegroundColor Green
Write-Host "  repository : https://github.com/$Owner/$Repo"
Write-Host "  actions    : https://github.com/$Owner/$Repo/actions"
