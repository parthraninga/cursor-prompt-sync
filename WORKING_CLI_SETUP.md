# Cursor Prompt Sync - Working CLI Setup Guide

## The Issue with `--command` Flag

The VS Code/Cursor CLI `--command` flag doesn't work as expected for extensions. Here are the **working solutions**:

## Method 1: Environment Variable + Restart (Simplest & Most Reliable)

```bash
# Step 1: Install extension
cursor --install-extension YorkIE.cursor-prompt-sync

# Step 2: Set environment variable
export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"

# Step 3: Start Cursor (extension will auto-configure on activation)
cursor .

# That's it! The extension will automatically detect the environment variable and configure itself
```

## Method 2: One-Liner (macOS/Linux)

```bash
CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" cursor --install-extension YorkIE.cursor-prompt-sync && CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" cursor .
```

## Method 3: Windows (PowerShell)

```powershell
$env:CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"
cursor --install-extension YorkIE.cursor-prompt-sync
cursor .
```

## Method 4: Windows (Command Prompt)

```batch
set CURSOR_PROMPT_SYNC_PASSWORD=YorkIEinterns
cursor --install-extension YorkIE.cursor-prompt-sync
cursor .
```

## How It Works Now

1. **Install Extension**: `cursor --install-extension YorkIE.cursor-prompt-sync`
2. **Set Password**: `export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"`
3. **Open Cursor**: `cursor .` (opens current directory)
4. **Auto-Configuration**: Extension detects environment variable and configures automatically
5. **Done**: PostgreSQL configured, scheduler started!

## Testing Your Fix

Try this corrected version:

```bash
# Fix the export (remove the $ before YorkIEinterns)
export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"

# Install extension
cursor --install-extension YorkIE.cursor-prompt-sync

# Open Cursor (this will trigger the auto-configuration)
cursor .
```

## What Happens

When you open Cursor with the environment variable set:

1. ✅ Extension activates
2. ✅ Detects `CURSOR_PROMPT_SYNC_PASSWORD` environment variable
3. ✅ Validates password (`YorkIEinterns`)
4. ✅ Auto-configures PostgreSQL silently
5. ✅ Starts auto-scheduler
6. ✅ Shows success message
7. ✅ Ready to use!

## User-Friendly Setup Script

Create a simple script for users:

```bash
#!/bin/bash
# setup.sh

echo "🚀 Installing Cursor Prompt Sync..."
cursor --install-extension YorkIE.cursor-prompt-sync

echo "🔧 Setting up auto-configuration..."
export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"

echo "📂 Opening Cursor for auto-setup..."
cursor .

echo "✅ Done! Check Cursor for the success message."
```

## Documentation for Users

Add this to your README:

```markdown
## 🚀 Quick CLI Setup

### One-Command Setup:
```bash
CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" cursor --install-extension YorkIE.cursor-prompt-sync && CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" cursor .
```

### Step-by-Step:
1. Install: `cursor --install-extension YorkIE.cursor-prompt-sync`
2. Set password: `export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"`
3. Open Cursor: `cursor .`
4. Done! Extension auto-configures on startup.

The extension will automatically:
- ✅ Configure PostgreSQL
- ✅ Start the auto-scheduler  
- ✅ Show success notification
```
```