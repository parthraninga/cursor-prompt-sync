import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DatabaseManager } from './databaseManager';
import { PostgresManager } from './postgresManager';
import { AutoScheduler } from './autoScheduler';
import { ResultsViewer } from './resultsViewer';
import { AutoStartupManager } from './autoStartupManager';
import { initializeSecretStorage, getDatabasePathSecret, setDatabasePathSecret, getUserIdSecret, setUserIdSecret } from './secretStorage';
import { POSTGRES_DEFAULTS } from './postgresDefaults';

/**
 * Auto-detect Cursor database path based on OS
 */
function detectCursorDatabasePath(): string | null {
    const homeDir = os.homedir();
    const platform = os.platform();
    
    let possiblePaths: string[] = [];
    
    if (platform === 'win32') {
        // Windows paths
        possiblePaths = [
            path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
            path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'logs', '*', 'state.vscdb')
        ];
    } else if (platform === 'darwin') {
        // macOS paths
        possiblePaths = [
            path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
        ];
    } else {
        // Linux paths
        possiblePaths = [
            path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
        ];
    }
    
    // Check each possible path
    for (const dbPath of possiblePaths) {
        if (dbPath.includes('*')) {
            // Handle wildcard paths (like logs/*/state.vscdb)
            const baseDir = path.dirname(dbPath.replace('*', ''));
            if (fs.existsSync(baseDir)) {
                const subdirs = fs.readdirSync(baseDir);
                for (const subdir of subdirs) {
                    const fullPath = path.join(baseDir, subdir, 'state.vscdb');
                    if (fs.existsSync(fullPath)) {
                        return fullPath;
                    }
                }
            }
        } else {
            if (fs.existsSync(dbPath)) {
                return dbPath;
            }
        }
    }
    
    return null;
}

async function isPostgresConfigurationComplete(): Promise<boolean> {
    const databasePath = await getDatabasePathSecret();
    const userId = await getUserIdSecret();
    return !!(databasePath && userId);
}

/**
 * Auto-configure missing settings
 */
async function autoConfigureMissingSettings(): Promise<boolean> {
    let configured = false;
    
    const databasePath = await getDatabasePathSecret();
    if (!databasePath) {
        const detectedPath = detectCursorDatabasePath();
        if (detectedPath) {
            await setDatabasePathSecret(detectedPath);
            console.log(`✅ Auto-detected database path: ${detectedPath}`);
            configured = true;
        }
    }
    
    const userId = await getUserIdSecret();
    if (!userId) {
        const defaultUserId = `user-${Date.now()}`;
        await setUserIdSecret(defaultUserId);
        console.log(`✅ Auto-generated user ID: ${defaultUserId}`);
        configured = true;
    }
    
    return configured;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Cursor Prompt Sync extension is now active!');
    initializeSecretStorage(context);

    // Initialize managers
    const databaseManager = new DatabaseManager();
    const postgresManager = new PostgresManager();
    const resultsViewer = new ResultsViewer(context);
    const autoStartupManager = new AutoStartupManager(context);
    const autoScheduler = new AutoScheduler(databaseManager, resultsViewer, postgresManager, context, autoStartupManager);

    // Store globally for deactivate function access
    (global as any).__cursorPromptSyncContext = context;
    (global as any).__cursorPromptSyncAutoStartupManager = autoStartupManager;

    // Smart configuration on activation with auto-startup
    setTimeout(async () => {
        try {
            console.log('⚙️ Cursor Prompt Sync: initialization checks starting...');

            // Auto-configure database path and user ID
            const autoConfigured = await autoConfigureMissingSettings();
            if (autoConfigured) {
                console.log('✅ Auto-configured missing settings');
            }

            // Handle PostgreSQL configuration with persistence
            const hasConfiguredPostgres = context.globalState.get<boolean>('cursorPromptSync.postgresConfigured') || false;
            let postgresReady = false;
            
            if (!hasConfiguredPostgres) {
                // First time setup - prompt for PostgreSQL configuration
                console.log('🔧 First-time PostgreSQL setup required...');
                
                const configured = await autoScheduler.configurePostgres(false); // Show password prompt
                if (configured) {
                    await context.globalState.update('cursorPromptSync.postgresConfigured', true);
                    postgresReady = true;
                    console.log('✅ PostgreSQL configured and saved for future use');
                    
                    // Show welcome message
                    vscode.window.showInformationMessage(
                        '🎉 Cursor Prompt Sync is now configured! Auto-scheduler will start automatically.',
                        'Show Status'
                    ).then(selection => {
                        if (selection === 'Show Status') {
                            vscode.commands.executeCommand('cursor-sql-runner.showAutoSchedulerStatus');
                        }
                    });
                } else {
                    console.log('⚠️ PostgreSQL configuration failed or was cancelled');
                    vscode.window.showWarningMessage(
                        'PostgreSQL configuration is required for auto-scheduler. Extension will retry on next startup.',
                        'Try Again'
                    ).then(selection => {
                        if (selection === 'Try Again') {
                            vscode.commands.executeCommand('cursor-sql-runner.configureAutoSchedulerPostgres');
                        }
                    });
                    // Don't return - still start scheduler with limited functionality
                }
            } else {
                // PostgreSQL was previously configured, try to initialize it silently
                console.log('🔄 Initializing previously configured PostgreSQL...');
                try {
                    const initialized = await postgresManager.initialize();
                    if (initialized) {
                        // Verify the connection still works
                        const connectionWorks = await postgresManager.testConnection();
                        if (connectionWorks) {
                            postgresReady = true;
                            console.log('✅ PostgreSQL connection restored successfully');
                        } else {
                            console.log('⚠️ PostgreSQL connection test failed');
                            // Mark as needing reconfiguration
                            await context.globalState.update('cursorPromptSync.postgresConfigured', false);
                        }
                    } else {
                        console.log('⚠️ PostgreSQL initialization failed - may need reconfiguration');
                        // Mark as needing reconfiguration  
                        await context.globalState.update('cursorPromptSync.postgresConfigured', false);
                    }
                } catch (error: any) {
                    console.log('⚠️ PostgreSQL restoration failed:', error.message);
                    // Mark as needing reconfiguration
                    await context.globalState.update('cursorPromptSync.postgresConfigured', false);
                }
            }
            
            if (postgresReady) {
                console.log('✅ PostgreSQL is ready for auto-scheduler operations');
            } else {
                console.log('⚠️ PostgreSQL not ready - auto-scheduler will run with limited functionality');
            }

            // Auto-startup logic - ALWAYS start when VS Code/Cursor opens
            console.log('🚀 Starting scheduler automatically (always ON when VS Code opens)...');
            await autoScheduler.start(true); // Silent start
            console.log(postgresReady 
                ? '✅ Scheduler started successfully with PostgreSQL' 
                : '✅ Scheduler started (PostgreSQL will be retried)');
        } catch (error: any) {
            console.log('⚠️ Activation initialization error:', error.message);
        }
    }, 1000);

    // Register only auto-scheduler related commands (with silent error handling for duplicates)
    const commands: vscode.Disposable[] = [];
    
    try {
        // Auto-scheduler configuration commands
        commands.push(vscode.commands.registerCommand('cursor-sql-runner.configureAutoScheduler', async () => {
            await autoScheduler.setInterval();
        }));

        commands.push(vscode.commands.registerCommand('cursor-sql-runner.configureAutoSchedulerPostgres', async () => {
            await autoScheduler.configurePostgres();
        }));

        // Auto-scheduler control commands
        commands.push(vscode.commands.registerCommand('cursor-sql-runner.startAutoScheduler', async () => {
            await autoScheduler.start();
        }));

        commands.push(vscode.commands.registerCommand('cursor-sql-runner.stopAutoScheduler', () => {
            autoScheduler.stop();
        }));

        commands.push(vscode.commands.registerCommand('cursor-sql-runner.toggleAutoScheduler', async () => {
            await autoScheduler.toggle();
        }));

        commands.push(vscode.commands.registerCommand('cursor-sql-runner.showAutoSchedulerStatus', () => {
            autoScheduler.showStatus();
        }));

        commands.push(vscode.commands.registerCommand('cursor-sql-runner.showDatabaseInfo', async () => {
            await showDatabaseInfoCommand(postgresManager);
        }));

        // Get last datapoint for current user from PostgreSQL
        commands.push(vscode.commands.registerCommand('cursor-sql-runner.getLastDatapoint', async () => {
            try {
                const initialized = await postgresManager.initialize();
                if (!initialized) {
                    vscode.window.showErrorMessage('PostgreSQL is not configured or reachable.');
                    return;
                }

                const userId = await getUserIdSecret();
                const datapoint = await postgresManager.getLastDatapoint();

                if (!datapoint) {
                    vscode.window.showInformationMessage(
                        userId
                            ? `No datapoints found in PostgreSQL for user "${userId}".`
                            : 'No datapoints found in PostgreSQL.'
                    );
                    return;
                }

                const infoLines = [
                    '🕒 Last Datapoint from PostgreSQL',
                    userId ? `👤 User: ${userId}` : '👤 User: (not set)',
                    `⏰ Timestamp: ${datapoint.timestamp}`,
                    `💬 Prompt: ${datapoint.prompt ?? '(no prompt stored)'}`,
                ];

                const msg = infoLines.join('\n');
                const output = vscode.window.createOutputChannel('Cursor Prompt Sync - Last Datapoint');
                output.clear();
                output.appendLine(msg);
                output.show();

                vscode.window.showInformationMessage('Last PostgreSQL datapoint displayed in output channel', 'Show Details')
                    .then(selection => {
                        if (selection === 'Show Details') {
                            output.show();
                        }
                    });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to fetch last datapoint: ${error.message ?? String(error)}`);
            }
        }));
    } catch (error: any) {
        // Silently ignore duplicate registration errors - no notifications shown
        // This prevents "Cannot register 'command'. This property is already registered" errors
        console.log('Command registration handled silently:', error.message);
    }

    // Add all command disposables to context
    commands.forEach(command => context.subscriptions.push(command));

    // Initialize auto-scheduler status bar and auto-startup manager
    context.subscriptions.push(autoScheduler);
    context.subscriptions.push(autoStartupManager);
}

export function deactivate() {
    console.log('Cursor Prompt Sync extension is now deactivated');
    
    // Record session end for fresh startup detection
    // Note: We need to access the autoStartupManager instance
    // This is a simple approach - in a real scenario, you might want to make this more robust
    try {
        const context = (global as any).__cursorPromptSyncContext;
        if (context) {
            const autoStartupManager = (global as any).__cursorPromptSyncAutoStartupManager;
            if (autoStartupManager) {
                autoStartupManager.recordSessionEnd();
            }
        }
    } catch (error) {
        console.log('Note: Could not record session end (normal during first run)');
    }
}

// Helper function for showing current database information
async function showDatabaseInfoCommand(postgresManager: PostgresManager): Promise<void> {
    try {
        const localDbPath = await getDatabasePathSecret() || 'Not configured';
        let localDbInfo = 'Not accessible';
        
        try {
            const fs = require('fs');
            if (localDbPath !== 'Not configured' && fs.existsSync(localDbPath)) {
                const stats = fs.statSync(localDbPath);
                const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
                const lastModified = stats.mtime.toLocaleString();
                localDbInfo = `Size: ${sizeInMB} MB, Modified: ${lastModified}`;
            } else if (localDbPath !== 'Not configured') {
                localDbInfo = 'File not found';
            }
        } catch (error) {
            localDbInfo = 'Error accessing file';
        }

        const { host: postgresHost, port: postgresPort, database: postgresDatabase, tableName: postgresTable, user: postgresUser } = POSTGRES_DEFAULTS;
        const userId = await getUserIdSecret() || 'Not configured';
        
        let postgresStatus = 'Not initialized';
        let recordCount = 'Unknown';
        
        if (postgresManager.isInitialized()) {
            postgresStatus = '✅ Connected';
            try {
                // Test connection and get some basic info
                const connected = await postgresManager.testConnection();
                if (connected) {
                    recordCount = 'Connection verified';
                } else {
                    recordCount = 'Connection failed';
                }
            } catch (error) {
                recordCount = 'Error checking connection';
            }
        } else if (postgresDatabase !== 'Not configured') {
            postgresStatus = '⚠️ Configured but not connected';
        }

        // Create info message
        const infoMessage = `
🗄️ **DATABASE CONFIGURATION**

**📂 Local Database (Source)**
Path: ${localDbPath}
Info: ${localDbInfo}

**🐘 PostgreSQL Database (Destination)**  
Host: ${postgresHost}:${postgresPort}
Database: ${postgresDatabase}
Table: ${postgresTable}
User: ${postgresUser}
Status: ${postgresStatus}
Records: ${recordCount}
User ID: ${userId}

**⚡ Prompt Sync**
Reads from local → Stores to PostgreSQL
        `.trim();

        // Show in information message and output channel
        const outputChannel = vscode.window.createOutputChannel('Database Configuration');
        outputChannel.clear();
        outputChannel.appendLine(infoMessage);
        outputChannel.show();

        vscode.window.showInformationMessage(
            'Database configuration displayed in output channel',
            'Show Details'
        ).then((selection: any) => {
            if (selection === 'Show Details') {
                outputChannel.show();
            }
        });

    } catch (error: any) {
        vscode.window.showErrorMessage(`Error showing database info: ${error.message}`);
    }
}
