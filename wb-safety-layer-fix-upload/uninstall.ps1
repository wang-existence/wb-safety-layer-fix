# Removes the wb-safety-layer-fix plugin and the wb-local marketplace registration.
#
# Compatible with Windows PowerShell 5.1 and PowerShell 7+.
#
# Reverse of install.ps1: drops the enabledPlugins flag, the installed_plugins
# entry and the known_marketplaces entry, then deletes the marketplace and cache
# directories. Each JSON file is backed up first as <name>.bak-<timestamp>. The
# plugin source directory you ran this from is never touched.
#
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$MarketplaceName = 'wb-local'
$PluginName      = 'wb-safety-layer-fix'

$ProfileRoot    = Join-Path $env:USERPROFILE '.workbuddy'
$PluginsRoot    = Join-Path $ProfileRoot 'plugins'
$MarketplaceDir = Join-Path $PluginsRoot "marketplaces\$MarketplaceName"
$CacheRoot      = Join-Path $PluginsRoot "cache\$MarketplaceName"
$KnownFile      = Join-Path $PluginsRoot 'known_marketplaces.json'
$InstalledFile  = Join-Path $PluginsRoot 'installed_plugins.json'
$SettingsFile   = Join-Path $ProfileRoot 'settings.json'

$running = @(Get-Process -Name 'WorkBuddy' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0 -and -not $Force) {
    throw "WorkBuddy is running (pid $($running.Id -join ', ')). Close it, or re-run with -Force."
}

function Backup-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = "$Path.bak-$stamp"
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    Write-Host "backup       $backup"
}

function Read-Json([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $raw = [System.IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ($raw | ConvertFrom-Json)
}

function Get-JsonProp($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function Remove-JsonProp($Object, [string]$Name) {
    if ($null -eq $Object) { return $false }
    $prop = $Object.PSObject.Properties[$Name]
    if (-not $prop) { return $false }
    $Object.PSObject.Properties.Remove($Name)
    return $true
}

function Write-Json([string]$Path, $Object) {
    $json = $Object | ConvertTo-Json -Depth 64
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8)
    Write-Host "wrote        $Path"
}

$key = "$PluginName@$MarketplaceName"

# 0. roll the file patches back before the payload disappears
$installedPurge = Join-Path $CacheRoot 'wb-safety-layer-fix\2.0.0\bin\wb-purge.mjs'
if (-not (Test-Path -LiteralPath $installedPurge)) {
    $found = Get-ChildItem -LiteralPath $CacheRoot -Recurse -Filter 'wb-purge.mjs' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $installedPurge = $found.FullName }
}
if (Test-Path -LiteralPath $installedPurge) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        Write-Host '--- reverting wb-purge patches ---'
        & $node.Source $installedPurge revert
        & $node.Source $installedPurge status
    } else {
        Write-Host 'WARN         node not found — run  node bin\wb-purge.mjs revert  manually before uninstalling' -ForegroundColor Yellow
    }
}

# 1. enabledPlugins flag
$settings = Read-Json $SettingsFile
$enabled = Get-JsonProp $settings 'enabledPlugins'
if ($enabled -and (Get-JsonProp $enabled $key) -ne $null) {
    Backup-File $SettingsFile
    Remove-JsonProp $enabled $key | Out-Null
    Write-Json -Path $SettingsFile -Object $settings
}

# 2. installed_plugins entry
$installed = Read-Json $InstalledFile
$plugins = Get-JsonProp $installed 'plugins'
if ($plugins -and (Get-JsonProp $plugins $key) -ne $null) {
    Backup-File $InstalledFile
    Remove-JsonProp $plugins $key | Out-Null
    Write-Json -Path $InstalledFile -Object $installed
}

# 3. known_marketplaces entry
$known = Read-Json $KnownFile
if ($known -and (Get-JsonProp $known $MarketplaceName) -ne $null) {
    Backup-File $KnownFile
    Remove-JsonProp $known $MarketplaceName | Out-Null
    Write-Json -Path $KnownFile -Object $known
}

# 4. payload directories - resolve and verify the prefix before deleting
$root = (Resolve-Path -LiteralPath $PluginsRoot).Path.TrimEnd('\')
foreach ($dir in @($MarketplaceDir, $CacheRoot)) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $resolved = (Resolve-Path -LiteralPath $dir).Path
    if (-not $resolved.StartsWith($root + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete $resolved - it is outside $root"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    Write-Host "removed      $resolved"
}

Write-Host ''
Write-Host 'OK           wb-safety-layer-fix removed.' -ForegroundColor Green
Write-Host 'Restart WorkBuddy so the CLI runtime drops the mod registration.'
