# Cursor Prompt Sync - CLI Setup Guide

After publishing your extension, users can use these commands for automatic setup.

> 📖 **See [CLI_OUTPUT_GUIDE.md](CLI_OUTPUT_GUIDE.md) for detailed console output examples and troubleshooting.**

## Method 1: Environment Variable + Launch (Simplest)

This is the simplest method that works automatically when the extension starts:

### macOS/Linux:
```bash
# Install and auto-configure on launch
cursor --install-extension YorkIE.cursor-prompt-sync && export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" && cursor .

# Or as separate steps:
cursor --install-extension YorkIE.cursor-prompt-sync
export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"
cursor .
```

### Windows (PowerShell):
```powershell
cursor --install-extension YorkIE.cursor-prompt-sync; $env:CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"; cursor .
```

## Method 2: Environment Variable + Command (Advanced)

### macOS/Linux:
```bash
# One-liner with default password
CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" cursor --install-extension YorkIE.cursor-prompt-sync && sleep 3 && CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" cursor --command cursor-sql-runner.cliAutoSetup

# One-liner with custom password
CURSOR_PROMPT_SYNC_PASSWORD="your_password" cursor --install-extension YorkIE.cursor-prompt-sync && sleep 3 && CURSOR_PROMPT_SYNC_PASSWORD="your_password" cursor --command cursor-sql-runner.cliAutoSetup
```

### Windows (Command Prompt):
```batch
set CURSOR_PROMPT_SYNC_PASSWORD=YorkIEinterns && cursor --install-extension YorkIE.cursor-prompt-sync && timeout /t 3 && cursor --command cursor-sql-runner.cliAutoSetup
```

### Windows (PowerShell):
```powershell
$env:CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"; cursor --install-extension YorkIE.cursor-prompt-sync; Start-Sleep 3; cursor --command cursor-sql-runner.cliAutoSetup
```

## Method 2: Using Setup Scripts

### Download and run setup script:
```bash
# macOS/Linux
curl -sSL https://raw.githubusercontent.com/your-repo/cursor-prompt-sync/main/setup-cursor-prompt-sync.sh | bash

# Windows (PowerShell)
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/your-repo/cursor-prompt-sync/main/setup-cursor-prompt-sync.ps1" -OutFile "setup.ps1"; .\setup.ps1; Remove-Item setup.ps1
```

## Method 3: Step by Step Commands

```bash
# Step 1: Install extension
cursor --install-extension YorkIE.cursor-prompt-sync

# Step 2: Set password and configure (run after installation completes)
export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"  # or your password
cursor --command cursor-sql-runner.cliAutoSetup
```

## How It Works

1. **Installation**: `cursor --install-extension YorkIE.cursor-prompt-sync` installs the extension
2. **Environment Variable**: `CURSOR_PROMPT_SYNC_PASSWORD` provides the password to the extension
3. **CLI Command**: `cursor-sql-runner.cliAutoSetup` triggers automatic configuration
4. **Auto-Configuration**: Extension reads the environment variable and configures PostgreSQL silently
5. **Auto-Start**: Extension automatically starts the scheduler after configuration

## User Documentation Template

Add this to your README.md:

```markdown
## 🚀 One-Command Installation & Setup

### Quick Setup (macOS/Linux):
```bash
CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" cursor --install-extension YorkIE.cursor-prompt-sync && sleep 3 && CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" cursor --command cursor-sql-runner.cliAutoSetup
```

### Quick Setup (Windows PowerShell):
```powershell
$env:CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"; cursor --install-extension YorkIE.cursor-prompt-sync; Start-Sleep 3; cursor --command cursor-sql-runner.cliAutoSetup
```

### Alternative: Download Setup Script:
```bash
curl -sSL https://your-domain.com/setup.sh | bash
```

After running, your extension will be:
- ✅ Installed
- ✅ PostgreSQL configured  
- ✅ Auto-scheduler running
- ✅ Ready to use!
```
```