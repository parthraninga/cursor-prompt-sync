import * as vscode from 'vscode';
import { DatabaseManager } from './databaseManager';
import { PostgresManager } from './postgresManager';
import { AutoScheduler } from './autoScheduler';
import { ResultsViewer } from './resultsViewer';

export function activate(context: vscode.ExtensionContext) {
    console.log('Cursor Prompt Sync extension is now active!');

    // Initialize managers (minimal dependencies for auto-scheduler)
    const databaseManager = new DatabaseManager();
    const postgresManager = new PostgresManager();
    const resultsViewer = new ResultsViewer(context); // Minimal instance
    const autoScheduler = new AutoScheduler(databaseManager, resultsViewer, postgresManager, context);

    // Register only auto-scheduler related commands
    const commands = [
        // PostgreSQL setup (required for auto-scheduler)
        vscode.commands.registerCommand('cursor-sql-runner.setupPostgres', async () => {
            await setupPostgresCommand(postgresManager);
        }),

        // Auto-scheduler configuration commands
        vscode.commands.registerCommand('cursor-sql-runner.configureAutoScheduler', async () => {
            await autoScheduler.setInterval();
        }),

        vscode.commands.registerCommand('cursor-sql-runner.configureAutoSchedulerPostgres', async () => {
            await autoScheduler.configurePostgres();
        }),

        // Auto-scheduler control commands
        vscode.commands.registerCommand('cursor-sql-runner.startAutoScheduler', async () => {
            await autoScheduler.start();
        }),

        vscode.commands.registerCommand('cursor-sql-runner.stopAutoScheduler', () => {
            autoScheduler.stop();
        }),

        vscode.commands.registerCommand('cursor-sql-runner.toggleAutoScheduler', async () => {
            await autoScheduler.toggle();
        }),

        vscode.commands.registerCommand('cursor-sql-runner.showAutoSchedulerStatus', () => {
            autoScheduler.showStatus();
        }),

        // Helper command for debugging
        vscode.commands.registerCommand('cursor-sql-runner.getLastDatapoint', async () => {
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
        })
    ];

    // Add all command disposables to context
    commands.forEach(command => context.subscriptions.push(command));

    // Initialize auto-scheduler status bar
    context.subscriptions.push(autoScheduler);
}

export function deactivate() {
    console.log('Cursor Prompt Sync extension is now deactivated');
}

// Helper function for PostgreSQL setup
async function setupPostgresCommand(postgresManager: PostgresManager): Promise<void> {
    try {
        // Get PostgreSQL connection details
        const host = await vscode.window.showInputBox({
            prompt: 'Enter PostgreSQL host',
            value: '3.108.9.100'
        });
        if (!host) return;

        const port = await vscode.window.showInputBox({
            prompt: 'Enter PostgreSQL port',
            value: '5432'
        });
        if (!port) return;

        const database = await vscode.window.showInputBox({
            prompt: 'Enter PostgreSQL database name',
            value: 'cursor_analytics'
        });
        if (!database) return;

        const user = await vscode.window.showInputBox({
            prompt: 'Enter PostgreSQL username',
            value: 'postgres'
        });
        if (!user) return;

        const password = await vscode.window.showInputBox({
            prompt: 'Enter PostgreSQL password',
            value: 'postgres',
            password: true
        });
        if (!password) return;

        const tableName = await vscode.window.showInputBox({
            prompt: 'Enter table name for storing cursor query results',
            value: 'cursor_query_results'
        });
        if (!tableName) return;

        // Update VS Code settings
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        await config.update('postgresHost', host, vscode.ConfigurationTarget.Workspace);
        await config.update('postgresPort', parseInt(port), vscode.ConfigurationTarget.Workspace);
        await config.update('postgresDatabase', database, vscode.ConfigurationTarget.Workspace);
        await config.update('postgresUser', user, vscode.ConfigurationTarget.Workspace);
        await config.update('postgresPassword', password, vscode.ConfigurationTarget.Workspace);
        await config.update('postgresTableName', tableName, vscode.ConfigurationTarget.Workspace);

        // Test connection
        await postgresManager.initialize();
        
        vscode.window.showInformationMessage(
            `✅ PostgreSQL connection configured successfully!\nDatabase: ${database}\nTable: ${tableName}\nYou can now configure and start the auto-scheduler.`
        );

    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to setup PostgreSQL: ${error.message}`);
    }
}
