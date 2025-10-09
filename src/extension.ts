import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { DatabaseManager } from './databaseManager';
import { PostgresManager } from './postgresManager';
import { AutoScheduler } from './autoScheduler';
import { ResultsViewer } from './resultsViewer';

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

/**
 * Check if configuration is complete
 */
function isConfigurationComplete(): boolean {
    const config = vscode.workspace.getConfiguration('cursorSqlRunner');
    
    const supabaseUrl = config.get<string>('supabaseUrl', '');
    const supabaseKey = config.get<string>('supabaseKey', '');
    const databasePath = config.get<string>('databasePath', '');
    
    return !!(supabaseUrl && supabaseKey && databasePath);
}

/**
 * Auto-configure missing settings
 */
async function autoConfigureMissingSettings(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('cursorSqlRunner');
    let configured = false;
    
    // Auto-detect database path if not configured
    let databasePath = config.get<string>('databasePath', '');
    if (!databasePath) {
        const detectedPath = detectCursorDatabasePath();
        if (detectedPath) {
            await config.update('databasePath', detectedPath, vscode.ConfigurationTarget.Global);
            console.log(`✅ Auto-detected database path: ${detectedPath}`);
            configured = true;
        }
    }
    
    // Set default user ID if not configured
    let userId = config.get<string>('userId', '');
    if (!userId) {
        const defaultUserId = `user-${Date.now()}`;
        await config.update('userId', defaultUserId, vscode.ConfigurationTarget.Global);
        console.log(`✅ Auto-generated user ID: ${defaultUserId}`);
        configured = true;
    }
    
    // Set default interval if not configured
    const interval = config.get<number>('autoSchedulerInterval', 0);
    if (interval === 0) {
        await config.update('autoSchedulerInterval', 60, vscode.ConfigurationTarget.Global);
        console.log(`✅ Set default interval: 60 minutes`);
        configured = true;
    }
    
    return configured;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Cursor Prompt Sync extension is now active!');

    // Initialize managers
    const databaseManager = new DatabaseManager();
    const postgresManager = new PostgresManager();
    const resultsViewer = new ResultsViewer(context);
    const autoScheduler = new AutoScheduler(databaseManager, resultsViewer, postgresManager, context);

    // Smart configuration and auto-startup
    setTimeout(async () => {
        try {
            console.log('🔍 Checking extension configuration...');
            
            // Auto-configure missing settings
            const autoConfigured = await autoConfigureMissingSettings();
            if (autoConfigured) {
                console.log('✅ Auto-configured missing settings');
            }
            
            // Check if configuration is complete
            const isComplete = isConfigurationComplete();
            
            if (isComplete) {
                console.log('✅ Configuration complete, starting auto-scheduler...');
                
                // Configure PostgreSQL silently
                try {
                    await autoScheduler.configurePostgres(true);
                    console.log('✅ PostgreSQL configured successfully');
                } catch (error: any) {
                    console.log('⚠️ PostgreSQL configuration failed, continuing without database sync');
                }
                
                // Start the scheduler
                await autoScheduler.start(true);
                console.log('✅ Auto-Scheduler started automatically');
                
            } else {
                console.log('⚠️ Configuration incomplete. PostgreSQL setup required for full functionality.');
                
                // Show one-time notification about setup
                const config = vscode.workspace.getConfiguration('cursorSqlRunner');
                const hasShownSetupNotice = config.get<boolean>('hasShownSetupNotice', false);
                
                if (!hasShownSetupNotice) {
                    const choice = await vscode.window.showInformationMessage(
                        'Cursor Prompt Sync needs PostgreSQL configuration for data storage. Configure now?',
                        'Setup Supabase', 'Skip'
                    );
                    
                    if (choice === 'Setup Supabase') {
                        await vscode.commands.executeCommand('cursor-sql-runner.configureAutoSchedulerSupabase');
                    }
                    
                    // Mark that we've shown the notice
                    await config.update('hasShownSetupNotice', true, vscode.ConfigurationTarget.Global);
                }
            }
            
        } catch (error: any) {
            console.log('⚠️ Auto-startup error:', error.message);
        }
    }, 1000); // Wait 1 second after activation

    // Register only auto-scheduler related commands (with silent error handling for duplicates)
    const commands: vscode.Disposable[] = [];
    
    try {
        // PostgreSQL setup (required for auto-scheduler)
        commands.push(vscode.commands.registerCommand('cursor-sql-runner.setupPostgres', async () => {
            await setupPostgresCommand(postgresManager);
        }));

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

        // Helper command for debugging
        commands.push(vscode.commands.registerCommand('cursor-sql-runner.getLastDatapoint', async () => {
            try {
                const lastDatapoint = await postgresManager.getLastDatapoint();
                if (lastDatapoint) {
                    vscode.window.showInformationMessage(
                        `Last datapoint: ${lastDatapoint.timestamp} - "${lastDatapoint.prompt?.substring(0, 100)}..."`
                    );
                } else {
                    vscode.window.showInformationMessage('No datapoints found in Supabase');
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Error getting last datapoint: ${error.message}`);
            }
        }));

        // Configure User ID command
        commands.push(vscode.commands.registerCommand('cursor-sql-runner.configureUserId', async () => {
            await configureUserIdCommand();
        }));

        // Database configuration commands
        commands.push(vscode.commands.registerCommand('cursor-sql-runner.configureDatabasePath', async () => {
            await configureDatabasePathCommand();
        }));

        commands.push(vscode.commands.registerCommand('cursor-sql-runner.switchPostgresDatabase', async () => {
            await switchPostgresDatabaseCommand(postgresManager);
        }));

        commands.push(vscode.commands.registerCommand('cursor-sql-runner.showDatabaseInfo', async () => {
            await showDatabaseInfoCommand(postgresManager);
        }));
    } catch (error: any) {
        // Silently ignore duplicate registration errors - no notifications shown
        // This prevents "Cannot register 'command'. This property is already registered" errors
        console.log('Command registration handled silently:', error.message);
    }

    // Add all command disposables to context
    commands.forEach(command => context.subscriptions.push(command));

    // Initialize auto-scheduler status bar
    context.subscriptions.push(autoScheduler);
}

export function deactivate() {
    console.log('Cursor Prompt Sync extension is now deactivated');
}

// Helper function for configuring User ID
async function configureUserIdCommand(): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const currentUserId = config.get<string>('userId') || '';

        const userId = await vscode.window.showInputBox({
            prompt: 'Enter your User ID for Supabase records',
            placeHolder: 'e.g., john.doe, user123, etc.',
            value: currentUserId,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'User ID cannot be empty';
                }
                if (value.length > 50) {
                    return 'User ID must be 50 characters or less';
                }
                return null;
            }
        });

        if (userId !== undefined) {
            await config.update('userId', userId.trim(), vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`✅ User ID configured: ${userId.trim()}`);
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error configuring User ID: ${error.message}`);
    }
}

// Helper function for PostgreSQL setup
async function setupPostgresCommand(postgresManager: PostgresManager): Promise<void> {
    // Automatically configures PostgreSQL with default settings (in package.json)
    // Only asks for password if not already configured in package.json
    // Uses: 3.108.9.100:5432, database: cursor_analytics, user: postgres, table: cursor_query_results
    
    try {
        // Automatically use default configuration values instead of asking user
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        
        // Force EC2 configuration values (override any cached localhost values)
        const host = '3.108.9.100';  // Force EC2 IP
        const port = 5432;
        const database = 'cursor_analytics';
        const user = 'postgres';
        const tableName = 'cursor_query_results';
        
        // Only ask for password if not already configured
        let password = config.get<string>('postgresPassword') || '';
        
        if (!password) {
            // Ask for password only if not configured
            const passwordInput = await vscode.window.showInputBox({
                prompt: 'Enter PostgreSQL password (this is the only required input)',
                password: true,
                validateInput: (value) => {
                    if (!value) {
                        return 'Please enter a password';
                    }
                    return null;
                }
            });

            if (!passwordInput) {
                vscode.window.showWarningMessage('PostgreSQL setup cancelled - password is required');
                return;
            }
            password = passwordInput;
        }

        // Update VS Code settings GLOBALLY (works across all workspaces)
        // Force clear any cached localhost values
        await config.update('postgresHost', host, vscode.ConfigurationTarget.Global);
        await config.update('postgresPort', port, vscode.ConfigurationTarget.Global);
        await config.update('postgresDatabase', database, vscode.ConfigurationTarget.Global);
        await config.update('postgresUser', user, vscode.ConfigurationTarget.Global);
        await config.update('postgresPassword', password, vscode.ConfigurationTarget.Global);
        await config.update('postgresTableName', tableName, vscode.ConfigurationTarget.Global);

        console.log(`🔍 Configuration set to: ${host}:${port}/${database}`);

        // Test connection
        await postgresManager.initialize();
        
        vscode.window.showInformationMessage(
            `✅ PostgreSQL connection configured automatically!\n` +
            `🔧 Default Settings Used:\n` +
            `   • Host: ${host}:${port}\n` +
            `   • Database: ${database}\n` +
            `   • Table: ${tableName}\n` +
            `   • User: ${user}\n` +
            `\n✨ Ready to use! You can now start the auto-scheduler.`
        );

    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to setup PostgreSQL: ${error.message}`);
    }
}

// Helper function for configuring local database path
async function configureDatabasePathCommand(): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const currentPath = config.get<string>('databasePath') || '';

        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Select Cursor Database File',
            filters: {
                'Database files': ['vscdb', 'db', 'sqlite', 'sqlite3'],
                'All files': ['*']
            },
            title: 'Select Cursor Database File (usually state.vscdb)'
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        
        if (fileUri && fileUri[0]) {
            const selectedPath = fileUri[0].fsPath;
            
            // Validate that it's a SQLite database
            try {
                const fs = require('fs');
                if (!fs.existsSync(selectedPath)) {
                    throw new Error('File does not exist');
                }

                // Check file size (SQLite files are typically not empty)
                const stats = fs.statSync(selectedPath);
                if (stats.size === 0) {
                    throw new Error('Database file appears to be empty');
                }

                // Update configuration GLOBALLY (works across all workspaces)
                await config.update('databasePath', selectedPath, vscode.ConfigurationTarget.Global);
                
                vscode.window.showInformationMessage(
                    `✅ Database path configured successfully!\nPath: ${selectedPath}`
                );

            } catch (validateError: any) {
                vscode.window.showErrorMessage(`Invalid database file: ${validateError.message}`);
            }
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error configuring database path: ${error.message}`);
    }
}

// Helper function for switching PostgreSQL database/table
async function switchPostgresDatabaseCommand(postgresManager: PostgresManager): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const currentHost = config.get<string>('postgresHost') || '3.108.9.100';
        const currentPort = config.get<number>('postgresPort') || 5432;
        const currentDatabase = config.get<string>('postgresDatabase') || '';
        const currentTable = config.get<string>('postgresTableName') || 'cursor_query_results';

        // Show current configuration
        const action = await vscode.window.showQuickPick([
            {
                label: '🏠 Change Host',
                description: `Current: ${currentHost}`
            },
            {
                label: '🔌 Change Port',
                description: `Current: ${currentPort}`
            },
            {
                label: '🗄️ Change Database',
                description: `Current: ${currentDatabase || 'Not configured'}`
            },
            {
                label: '📋 Change Table Name',
                description: `Current: ${currentTable}`
            },
            {
                label: '🆕 Configure New Connection',
                description: 'Complete setup for a different database'
            }
        ], {
            placeHolder: 'What would you like to change?',
            title: 'Switch PostgreSQL Database Configuration'
        });

        if (!action) return;

        if (action.label.includes('Change Host')) {
            const newHost = await vscode.window.showInputBox({
                prompt: 'Enter new PostgreSQL host',
                value: currentHost,
                validateInput: (value) => {
                    if (!value) {
                        return 'Please enter a valid hostname';
                    }
                    return null;
                }
            });

            if (newHost) {
                await config.update('postgresHost', newHost, vscode.ConfigurationTarget.Global);
                await postgresManager.initialize();
                vscode.window.showInformationMessage(`✅ PostgreSQL host updated globally: ${newHost}`);
            }

        } else if (action.label.includes('Change Port')) {
            const newPortInput = await vscode.window.showInputBox({
                prompt: 'Enter new PostgreSQL port',
                value: currentPort.toString(),
                validateInput: (value) => {
                    const port = parseInt(value);
                    if (isNaN(port) || port <= 0 || port > 65535) {
                        return 'Please enter a valid port number (1-65535)';
                    }
                    return null;
                }
            });

            if (newPortInput) {
                const newPort = parseInt(newPortInput);
                await config.update('postgresPort', newPort, vscode.ConfigurationTarget.Global);
                await postgresManager.initialize();
                vscode.window.showInformationMessage(`✅ PostgreSQL port updated globally: ${newPort}`);
            }

        } else if (action.label.includes('Change Database')) {
            const newDatabase = await vscode.window.showInputBox({
                prompt: 'Enter new database name',
                value: currentDatabase,
                validateInput: (value) => {
                    if (!value || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                        return 'Please enter a valid database name (letters, numbers, underscores only)';
                    }
                    return null;
                }
            });

            if (newDatabase) {
                await config.update('postgresDatabase', newDatabase, vscode.ConfigurationTarget.Global);
                await postgresManager.initialize();
                vscode.window.showInformationMessage(`✅ Database name updated globally: ${newDatabase}`);
            }

        } else if (action.label.includes('Change Table Name')) {
            const newTable = await vscode.window.showInputBox({
                prompt: 'Enter new table name',
                value: currentTable,
                validateInput: (value) => {
                    if (!value || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                        return 'Please enter a valid table name (letters, numbers, underscores only)';
                    }
                    return null;
                }
            });

            if (newTable) {
                await config.update('postgresTableName', newTable, vscode.ConfigurationTarget.Global);
                await postgresManager.initialize();
                vscode.window.showInformationMessage(`✅ Table name updated globally: ${newTable}`);
            }

        } else if (action.label.includes('Configure New Connection')) {
            // Run the full setup command
            await setupPostgresCommand(postgresManager);
        }

    } catch (error: any) {
        vscode.window.showErrorMessage(`Error switching PostgreSQL database: ${error.message}`);
    }
}

// Helper function for showing current database information
async function showDatabaseInfoCommand(postgresManager: PostgresManager): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        
        // Get local database info
        const localDbPath = config.get<string>('databasePath') || 'Not configured';
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

        // Get PostgreSQL database info
        const postgresHost = config.get<string>('postgresHost') || '3.108.9.100';
        const postgresPort = config.get<number>('postgresPort') || 5432;
        const postgresDatabase = config.get<string>('postgresDatabase') || 'Not configured';
        const postgresTable = config.get<string>('postgresTableName') || 'cursor_query_results';
        const postgresUser = config.get<string>('postgresUser') || 'postgres';
        const userId = config.get<string>('userId') || 'Not configured';
        
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
