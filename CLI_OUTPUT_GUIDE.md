# CLI Auto-Configuration Output Guide

## Expected Console Output Examples

When you run the CLI setup with `export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns" && cursor .`, you should see detailed console output showing the auto-configuration process.

## First-Time CLI Setup (New Configuration)

```
🔍 [CLI DETECTION] Found environment variable CURSOR_PROMPT_SYNC_PASSWORD: "YorkIEinterns"
🔍 [CLI DETECTION] Environment variable detected successfully
🔧 [CLI AUTO-CONFIG] Starting CLI auto-configuration...
🔧 [CLI AUTO-CONFIG] Using password from environment: "YorkIEinterns"
✅ [CLI AUTO-CONFIG] Password validation successful
💾 [CLI AUTO-CONFIG] Storing CLI password in secret storage for persistence...
💾 [CLI AUTO-CONFIG] CLI password stored permanently (persists after env var removal)
🔄 [CLI AUTO-CONFIG] Configuring PostgreSQL...
✅ PostgreSQL configuration completed successfully
✅ [CLI AUTO-CONFIG] PostgreSQL configured successfully via CLI
💾 [CLI AUTO-CONFIG] All configuration saved to secret storage permanently
🎯 [AUTO-STARTUP] Extension successfully started
```

## Subsequent Launches (Existing Configuration)

### With Environment Variable Still Set:
```
🔍 [CLI DETECTION] Found environment variable CURSOR_PROMPT_SYNC_PASSWORD: "YorkIEinterns"
🔍 [CLI DETECTION] Environment variable detected successfully
✅ [AUTO-STARTUP] PostgreSQL already configured, skipping setup
🎯 [AUTO-STARTUP] Extension successfully started
```

### With Environment Variable Removed (Using Stored Password):
```
🔍 [CLI DETECTION] No CURSOR_PROMPT_SYNC_PASSWORD environment variable found
🔍 [CLI DETECTION] Found stored CLI password from previous setup
✅ [AUTO-STARTUP] PostgreSQL already configured, skipping setup
🎯 [AUTO-STARTUP] Extension successfully started
```

## Error Cases

### Invalid Password:
```
🔍 [CLI DETECTION] Found environment variable CURSOR_PROMPT_SYNC_PASSWORD: "wrongpassword"
🔍 [CLI DETECTION] Environment variable detected successfully
🔧 [CLI AUTO-CONFIG] Starting CLI auto-configuration...
🔧 [CLI AUTO-CONFIG] Using password from environment: "wrongpassword"
❌ [CLI AUTO-CONFIG] Invalid password provided: "wrongpassword"
❌ [CLI AUTO-CONFIG] Expected: "YorkIEinterns"
Error: Invalid CLI password. Please check CURSOR_PROMPT_SYNC_PASSWORD environment variable.
```

### No Environment Variable and No Stored Password:
```
🔍 [CLI DETECTION] No CURSOR_PROMPT_SYNC_PASSWORD environment variable found
🔍 [CLI DETECTION] No stored CLI password found either
🔧 First-time PostgreSQL setup required...
[Interactive password prompt appears]
```

## Features Demonstrated

1. **Environment Variable Detection**: Shows when `CURSOR_PROMPT_SYNC_PASSWORD` is found or missing
2. **Password Persistence**: CLI password is stored permanently in VS Code secret storage
3. **Fallback Mechanism**: Uses stored password when environment variable is removed
4. **Configuration Status**: Clear indication of new vs existing PostgreSQL configuration
5. **Auto-Startup Integration**: Seamless integration with the auto-startup system
6. **Error Handling**: Clear error messages for invalid passwords or missing configuration

## CLI Testing Commands

```bash
# Test 1: First-time CLI setup
export CURSOR_PROMPT_SYNC_PASSWORD="YorkIEinterns"
cursor .
# Expected: Full CLI auto-configuration with password storage

# Test 2: Subsequent launch with environment variable
cursor .
# Expected: Quick startup using existing configuration

# Test 3: Password persistence test
unset CURSOR_PROMPT_SYNC_PASSWORD
cursor .
# Expected: Still works using stored password

# Test 4: Invalid password test
export CURSOR_PROMPT_SYNC_PASSWORD="wrongpassword"
cursor .
# Expected: Error message about invalid password
```

## Success Indicators

✅ **CLI Setup Successful** if you see:
- Environment variable detection logs
- Password validation success
- PostgreSQL configuration completion
- Permanent storage confirmation
- Auto-startup activation

✅ **Extension Working** if you see:
- No error messages in console
- Success notification popup
- Extension commands available in Command Palette
- Auto-scheduler running (check status with Command Palette > "Show Auto-Scheduler Status")

## Troubleshooting

If you don't see the expected output:
1. Check VS Code Developer Console (Help > Toggle Developer Tools > Console tab)
2. Verify the environment variable is set: `echo $CURSOR_PROMPT_SYNC_PASSWORD`
3. Ensure you're using the exact password: `YorkIEinterns` (case-sensitive)
4. Check that the extension is properly installed and activated