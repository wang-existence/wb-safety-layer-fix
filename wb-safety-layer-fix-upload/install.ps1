# Installs the wb-safety-layer-fix plugin into the local WorkBuddy profile.
#
# Compatible with Windows PowerShell 5.1 and PowerShell 7+.
#
# Registers a local ("directory" type) marketplace named `wb-local`, copies the
# plugin payload into both the marketplace tree and the plugin cache, then wires
# the three registry files WorkBuddy reads on start:
#
#   plugins/known_marketplaces.json   -> marketplace entry (type: directory)
#   plugins/installed_plugins.json    -> wb-safety-layer-fix@wb-local + installPath
#   settings.json                     -> enabledPlugins["wb-safety-layer-fix@wb-local"]
#
# Every file is backed up next to itself as <name>.bak-<timestamp> before the
# rewrite. Re-running is safe (idempotent): existing entries are updated in place.
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Version 1.0.1 -Force
[CmdletBinding()]
param(
    [string]$Version = '2.1.1',
    [switch]$Force,
    [switch]$Purge
)

$ErrorActionPreference = 'Stop'

$MarketplaceName = 'wb-local'
$PluginName      = 'wb-safety-layer-fix'
$Source          = $PSScriptRoot
if (-not $Source) { $Source = (Get-Location).Path }

# ------------------------------------------------------------------ preflight

if (-not (Test-Path -LiteralPath (Join-Path $Source '.codebuddy-plugin\plugin.json'))) {
    throw "Run this script from the plugin directory: $Source does not look like a plugin."
}
if (-not (Test-Path -LiteralPath (Join-Path $Source 'hooks\hooks.json'))) {
    throw "hooks\hooks.json is missing under $Source"
}

$ProfileRoot = Join-Path $env:USERPROFILE '.workbuddy'
if (-not (Test-Path -LiteralPath $ProfileRoot)) {
    throw "WorkBuddy profile not found at $ProfileRoot - start WorkBuddy once first."
}

$running = @(Get-Process -Name 'WorkBuddy' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0 -and -not $Force) {
    throw "WorkBuddy is running (pid $($running.Id -join ', ')). Close it, or re-run with -Force (settings.json may be rewritten on exit)."
}

$PluginsRoot    = Join-Path $ProfileRoot 'plugins'
$MarketplaceDir = Join-Path $PluginsRoot "marketplaces\$MarketplaceName"
$PluginDir      = Join-Path $MarketplaceDir "plugins\$PluginName"
$CacheDir       = Join-Path $PluginsRoot "cache\$MarketplaceName\$PluginName\$Version"
$KnownFile      = Join-Path $PluginsRoot 'known_marketplaces.json'
$InstalledFile  = Join-Path $PluginsRoot 'installed_plugins.json'
$SettingsFile   = Join-Path $ProfileRoot 'settings.json'

Write-Host "profile      $ProfileRoot"
Write-Host "marketplace  $MarketplaceDir"
Write-Host "plugin       $PluginDir"
Write-Host "cache        $CacheDir"
Write-Host ''

# -------------------------------------------------------------------- helpers

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

function Set-JsonProp($Object, [string]$Name, $Value) {
    if ($null -eq $Object) { throw "cannot set '$Name' on a null object" }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { $prop.Value = $Value }
    else { $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force }
}

function Get-JsonProp($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function Write-Json([string]$Path, $Object) {
    $json = $Object | ConvertTo-Json -Depth 64
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8)
    Write-Host "wrote        $Path"
}

function Copy-PluginPayload([string]$Destination) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $exclude = @('tests', '.git', 'node_modules', 'install.ps1', 'uninstall.ps1', 'state')
    Get-ChildItem -LiteralPath $Source -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
}

# ------------------------------------------------------------------- payload

Copy-PluginPayload -Destination $PluginDir
Copy-PluginPayload -Destination $CacheDir

$marketplaceManifest = [ordered]@{
    name        = $MarketplaceName
    description = 'Local operator marketplace (hand-installed plugins).'
    plugins     = @(
        [ordered]@{
            name        = $PluginName
            version     = $Version
            source      = "./plugins/$PluginName"
            description = 'Repairs the buggy content-safety layer: injects a session operator policy, envelopes the user turn, removes canned refusal behaviour.'
        }
    )
}
New-Item -ItemType Directory -Path (Join-Path $MarketplaceDir '.codebuddy-plugin') -Force | Out-Null
Write-Json -Path (Join-Path $MarketplaceDir '.codebuddy-plugin\marketplace.json') -Object $marketplaceManifest

# --------------------------------------------------------------- registries

$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

Backup-File $KnownFile
$known = Read-Json $KnownFile
if ($null -eq $known) { $known = [pscustomobject]@{} }
Set-JsonProp $known $MarketplaceName ([ordered]@{
        manifestName    = $MarketplaceName
        type            = 'directory'
        source          = [ordered]@{ source = 'directory'; path = $MarketplaceDir }
        installLocation = $MarketplaceDir
        description     = 'Local operator marketplace (hand-installed plugins).'
        lastUpdated     = $stamp
        autoUpdate      = $false
    })
Write-Json -Path $KnownFile -Object $known

Backup-File $InstalledFile
$installed = Read-Json $InstalledFile
if ($null -eq $installed) { $installed = [pscustomobject]@{} }
Set-JsonProp $installed 'version' 2
$plugins = Get-JsonProp $installed 'plugins'
if ($null -eq $plugins -or $plugins -is [string] -or $plugins -is [array]) {
    $plugins = [pscustomobject]@{}
    Set-JsonProp $installed 'plugins' $plugins
}
# The host stores one entry per plugin as an ARRAY of installs (that is the shape its own
# built-in plugins use). Writing the same shape keeps the value stable across the host's
# own normalisation/rewrite passes.
$entry = [ordered]@{
    scope       = 'user'
    installPath = $CacheDir
    version     = $Version
    installedAt = $stamp
    lastUpdated = $stamp
}
Set-JsonProp $plugins "$PluginName@$MarketplaceName" ([System.Object[]]@($entry))
Write-Json -Path $InstalledFile -Object $installed

Backup-File $SettingsFile
$settings = Read-Json $SettingsFile
if ($null -eq $settings) { throw "settings.json is missing or empty at $SettingsFile" }
$enabled = Get-JsonProp $settings 'enabledPlugins'
if ($null -eq $enabled -or $enabled -is [string] -or $enabled -is [array]) {
    $enabled = [pscustomobject]@{}
    Set-JsonProp $settings 'enabledPlugins' $enabled
}
Set-JsonProp $enabled "$PluginName@$MarketplaceName" $true
Write-Json -Path $SettingsFile -Object $settings

# ------------------------------------------------------------------ verify

$failures = New-Object System.Collections.Generic.List[string]
$checks = @(
    @{ Path = (Join-Path $PluginDir '.codebuddy-plugin\plugin.json'); Label = 'plugin.json (marketplace copy)' },
    @{ Path = (Join-Path $CacheDir '.codebuddy-plugin\plugin.json'); Label = 'plugin.json (cache copy)' },
    @{ Path = (Join-Path $CacheDir 'hooks\hooks.json'); Label = 'hooks.json (cache copy)' },
    @{ Path = (Join-Path $CacheDir 'hooks\register.mjs'); Label = 'register.mjs (cache copy)' },
    @{ Path = $KnownFile; Label = 'known_marketplaces.json' },
    @{ Path = $InstalledFile; Label = 'installed_plugins.json' },
    @{ Path = $SettingsFile; Label = 'settings.json' }
)
foreach ($check in $checks) {
    if (-not (Test-Path -LiteralPath $check.Path)) {
        $failures.Add("missing $($check.Label): $($check.Path)")
        continue
    }
    if ($check.Path.EndsWith('.json')) {
        try { [System.IO.File]::ReadAllText($check.Path) | ConvertFrom-Json | Out-Null }
        catch { $failures.Add("invalid JSON in $($check.Label): $($_.Exception.Message)") }
    }
}

$hooksJson = [System.IO.File]::ReadAllText((Join-Path $CacheDir 'hooks\hooks.json')) | ConvertFrom-Json
if (-not (Get-JsonProp $hooksJson 'modules')) {
    $failures.Add('hooks.json has no "modules" array - the loader would skip this directory')
}

if ($failures.Count -gt 0) {
    Write-Host ''
    foreach ($failure in $failures) { Write-Host "FAIL         $failure" -ForegroundColor Red }
    throw 'Install verification failed; the registry files were backed up next to the originals.'
}

Write-Host ''
Write-Host 'OK           plugin installed and registered.' -ForegroundColor Green

if ($Purge) {
    Write-Host ''
    Write-Host '--- purge (prompt / code / engine layers) ---'
    $purgeCli = Join-Path $CacheDir 'bin\wb-purge.mjs'
    if (-not (Test-Path -LiteralPath $purgeCli)) { throw "wb-purge.mjs missing from the installed payload: $purgeCli" }
    $node = (Get-Command node -ErrorAction SilentlyContinue)
    if (-not $node) { throw 'node not found in PATH; install the purge layer manually with: node bin\wb-purge.mjs apply' }
    & $node.Source $purgeCli status
    & $node.Source $purgeCli apply
    & $node.Source $purgeCli verify
    if ($LASTEXITCODE -ne 0) { throw 'wb-purge verify failed 鈥?run: node bin\wb-purge.mjs revert' }
}

Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Start (or restart) WorkBuddy. The mod loads inside the CLI runtime, not the window.'
Write-Host '  2. In a session run  /purge-status   for the patch table, /safety-fix for the mod config.'
Write-Host '  3. Toggle with        /safety-toggle off   (or WB_SAFETY_LAYER_FIX=off)'
Write-Host '  4. Apply / roll back  /purge-apply  路  /purge-revert'
Write-Host ''
Write-Host 'Without -Purge only the plugin (mods + commands + skill) is installed; the file'
Write-Host 'patches stay pending until you run  node bin\wb-purge.mjs apply.'
Write-Host ''
Write-Host 'If a session still refuses, check the session debug log for the line'
Write-Host '  [wb-safety-fix] active enabled=true policy=true preamble=true engine=true ...'
Write-Host 'A missing line means the mods runtime is off (CBC_ENABLE_FUNCTION_HOOKS=0).'


