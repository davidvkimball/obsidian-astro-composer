# Sync .agents folder from master repo to all plugin repos
# This script is specific to David's development setup and is gitignored

param(
    [string]$MasterRepo = "obsidian-sample-plugin-plus",
    [string]$DevRoot = "C:\Users\david\Development"
)

$ErrorActionPreference = "Stop"

# List of plugins to sync (add/remove as needed)
$plugins = @(
    "obsidian-alias-filename-history",
    "obsidian-astro-composer",
    "obsidian-astro-modular-settings",
    "obsidian-bases-cms",
    "obsidian-custom-slides",
    "obsidian-disable-tabs",
    "obsidian-explorer-focus",
    "obsidian-home-base",
    "obsidian-image-manager",
    "obsidian-oxygen-settings",
    "obsidian-property-over-file-name",
    "obsidian-seo",
    "obsidian-ui-tweaker",
    "obsidian-vault-cms",
    "obsidian-zenmode"
)

$masterAgentsPath = Join-Path $DevRoot $MasterRepo ".agents"
$masterAgentsMdPath = Join-Path $DevRoot $MasterRepo "AGENTS.md"

# Verify master .agents exists
if (-not (Test-Path $masterAgentsPath)) {
    Write-Error "Master .agents folder not found at: $masterAgentsPath"
    exit 1
}

Write-Host "Syncing .agents from: $masterAgentsPath" -ForegroundColor Cyan
Write-Host ""

$successCount = 0
$skipCount = 0
$errorCount = 0

foreach ($plugin in $plugins) {
    $pluginPath = Join-Path $DevRoot $plugin
    $targetAgentsPath = Join-Path $pluginPath ".agents"
    $targetAgentsMdPath = Join-Path $pluginPath "AGENTS.md"
    
    # Check if plugin directory exists
    if (-not (Test-Path $pluginPath)) {
        Write-Host "⚠️  Skipping $plugin - directory not found" -ForegroundColor Yellow
        $skipCount++
        continue
    }
    
    try {
        # Remove existing .agents if it exists
        if (Test-Path $targetAgentsPath) {
            $item = Get-Item $targetAgentsPath -ErrorAction SilentlyContinue
            if ($item -and ($item.LinkType -eq "Junction" -or $item.LinkType -eq "SymbolicLink")) {
                # It's a symlink - remove it
                Write-Host "🔗 Removing existing symlink: $targetAgentsPath" -ForegroundColor Gray
                Remove-Item -Force $targetAgentsPath
            } else {
                # Remove directory
                Remove-Item -Recurse -Force $targetAgentsPath
            }
        }
        
        # Copy .agents folder
        Write-Host "📋 Syncing to: $plugin" -ForegroundColor Green
        Copy-Item -Recurse -Force $masterAgentsPath $targetAgentsPath
        
        # Verify AGENTS.md exists in target (should be preserved, but check)
        if (-not (Test-Path $targetAgentsMdPath)) {
            Write-Host "   ⚠️  Warning: AGENTS.md not found in $plugin - you may need to create it" -ForegroundColor Yellow
        } else {
            Write-Host "   ✓ AGENTS.md preserved" -ForegroundColor Gray
        }
        
        $successCount++
    }
    catch {
        Write-Host "   ❌ Error syncing $plugin : $_" -ForegroundColor Red
        $errorCount++
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "Sync Complete!" -ForegroundColor Cyan
Write-Host "  ✓ Success: $successCount" -ForegroundColor Green
Write-Host "  ⚠️  Skipped: $skipCount" -ForegroundColor Yellow
Write-Host "  ❌ Errors: $errorCount" -ForegroundColor $(if ($errorCount -gt 0) { "Red" } else { "Gray" })
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

if ($errorCount -gt 0) {
    exit 1
}

