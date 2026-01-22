#!/bin/bash
# Sync .agents folder from master repo to all plugin repos
# This script is specific to David's development setup and is gitignored

set -e

MASTER_REPO="obsidian-sample-plugin-plus"
DEV_ROOT="$HOME/Development"

# List of plugins to sync (add/remove as needed)
plugins=(
    "obsidian-alias-filename-history"
    "obsidian-astro-composer"
    "obsidian-astro-modular-settings"
    "obsidian-bases-cms"
    "obsidian-custom-slides"
    "obsidian-disable-tabs"
    "obsidian-explorer-focus"
    "obsidian-home-base"
    "obsidian-image-manager"
    "obsidian-oxygen-settings"
    "obsidian-property-over-file-name"
    "obsidian-seo"
    "obsidian-ui-tweaker"
    "obsidian-vault-cms"
    "obsidian-zenmode"
)

MASTER_AGENTS_PATH="$DEV_ROOT/$MASTER_REPO/.agents"
MASTER_AGENTS_MD_PATH="$DEV_ROOT/$MASTER_REPO/AGENTS.md"

# Verify master .agents exists
if [ ! -d "$MASTER_AGENTS_PATH" ]; then
    echo "❌ Master .agents folder not found at: $MASTER_AGENTS_PATH" >&2
    exit 1
fi

echo "📋 Syncing .agents from: $MASTER_AGENTS_PATH"
echo ""

success_count=0
skip_count=0

for plugin in "${plugins[@]}"; do
    plugin_path="$DEV_ROOT/$plugin"
    target_agents_path="$plugin_path/.agents"
    target_agents_md_path="$plugin_path/AGENTS.md"
    
    # Check if plugin directory exists
    if [ ! -d "$plugin_path" ]; then
        echo "⚠️  Skipping $plugin - directory not found"
        ((skip_count++))
        continue
    fi
    
    # Remove existing .agents if it exists
    if [ -e "$target_agents_path" ]; then
        if [ -L "$target_agents_path" ]; then
            # It's a symlink - remove it
            echo "🔗 Removing existing symlink: $target_agents_path"
            rm -f "$target_agents_path"
        else
            # Remove directory or file
            rm -rf "$target_agents_path"
        fi
    fi
    
    # Copy .agents folder
    echo "📋 Syncing to: $plugin"
    cp -r "$MASTER_AGENTS_PATH" "$target_agents_path"
    
    # Verify AGENTS.md exists in target (should be preserved, but check)
    if [ ! -f "$target_agents_md_path" ]; then
        echo "   ⚠️  Warning: AGENTS.md not found in $plugin - you may need to create it"
    else
        echo "   ✓ AGENTS.md preserved"
    fi
    
    ((success_count++))
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Sync Complete!"
echo "  ✓ Success: $success_count"
echo "  ⚠️  Skipped: $skip_count"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

