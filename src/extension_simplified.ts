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
