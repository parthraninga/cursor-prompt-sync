import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from './databaseManager';
import { ResultsViewer } from './resultsViewer';
import { PostgresManager } from './postgresManager';
import { AutoStartupManager } from './autoStartupManager';
import { POSTGRES_DEFAULTS } from './postgresDefaults';
import { getUserIdSecret, setUserIdSecret, getDatabasePathSecret, setDatabasePathSecret } from './secretStorage';

export class AutoScheduler {
    private intervalId: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private intervalMinutes: number = 60; // Default 1 hour
    private statusBarItem: vscode.StatusBarItem;
    private outputChannel: vscode.OutputChannel;
    private lastExecution: Date | null = null;
    private executionCount: number = 0;
    private errorCount: number = 0;
    private supabaseRetryCount: number = 0;
    private maxRetries: number = 3;

    constructor(
        private databaseManager: DatabaseManager,
        private resultsViewer: ResultsViewer,
        private postgresManager: PostgresManager,
        private context: vscode.ExtensionContext,
        private autoStartupManager?: AutoStartupManager
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Cursor Prompt Sync');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'cursor-sql-runner.toggleAutoScheduler';
        
        // Using embedded SQL query - no file setup needed
        
        this.updateStatusBar();
        this.statusBarItem.show();

        // Restore state
        this.restoreState();
        
        // Initialize database path detection on startup, then setup userId
        this.initializeExtension();
    }

    /**
     * Get the cached email from Cursor database (cursorAuth/cachedEmail from ItemTable)
     */
    private async getCachedEmailFromDatabase(): Promise<string | null> {
        try {
            this.outputChannel.appendLine(`🔍 [EMAIL DETECTION] Starting email detection process...`);
            
            const databasePath = await getDatabasePathSecret();
            
            this.outputChannel.appendLine(`🔍 [EMAIL DETECTION] Database path: ${databasePath}`);
            
            if (!databasePath) {
                this.outputChannel.appendLine(`❌ [EMAIL DETECTION] No database path configured`);
                return null;
            }
            
            // Check if database file exists
            const fs = require('fs');
            if (!fs.existsSync(databasePath)) {
                this.outputChannel.appendLine(`❌ [EMAIL DETECTION] Database file does not exist: ${databasePath}`);
                return null;
            }
            
            this.outputChannel.appendLine(`✅ [EMAIL DETECTION] Database file exists, size: ${fs.statSync(databasePath).size} bytes`);
            
            this.outputChannel.appendLine(`🔍 [EMAIL DETECTION] Executing query: SELECT value FROM ItemTable WHERE key = 'cursorAuth/cachedEmail'`);
            
            // Query the ItemTable for cursorAuth/cachedEmail
            const emailQuery = `
                SELECT value 
                FROM ItemTable 
                WHERE key = 'cursorAuth/cachedEmail'
                LIMIT 1;
            `;
            
            this.outputChannel.appendLine(`🔍 [EMAIL DETECTION] About to execute query via DatabaseManager...`);
            const results = await this.databaseManager.executeQuery(emailQuery);
            
            this.outputChannel.appendLine(`🔍 [EMAIL DETECTION] Query executed, results type: ${typeof results}, length: ${Array.isArray(results) ? results.length : 'N/A'}`);
            this.outputChannel.appendLine(`🔍 [EMAIL DETECTION] Raw results: ${JSON.stringify(results, null, 2)}`);
            
            if (results && results.length > 0) {
                this.outputChannel.appendLine(`🔍 [EMAIL DETECTION] First result: ${JSON.stringify(results[0], null, 2)}`);
                
                if (results[0].value) {
                    const email = results[0].value;
                    this.outputChannel.appendLine(`✅ [EMAIL DETECTION] SUCCESS: Found cached email in ItemTable: ${email}`);
                    return email;
                } else {
                    this.outputChannel.appendLine(`❌ [EMAIL DETECTION] Result exists but 'value' field is empty/null`);
                }
            } else {
                this.outputChannel.appendLine(`❌ [EMAIL DETECTION] EMPTY RESULT: No cached email found in ItemTable (results: ${JSON.stringify(results)})`);
            }
            
            return null;
        } catch (error) {
            this.outputChannel.appendLine(`❌ [EMAIL DETECTION] QUERY ERROR: Failed to query cached email from database: ${error}`);
            this.outputChannel.appendLine(`❌ [EMAIL DETECTION] Error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
            return null;
        }
    }

    /**
     * Ensure userId exists for PostgreSQL operations using cached email from database
     */
    private async ensureSupabaseUserId(): Promise<void> {
        let userId = await getUserIdSecret();
        
        // If no user ID is configured, this is first-time setup
        if (!userId) {
            this.outputChannel.appendLine(`🔍 First-time setup detected - querying Cursor database for cached email...`);
            
            // Run the email detection query
            const cachedEmail = await this.getCachedEmailFromDatabase();
            if (cachedEmail) {
                userId = cachedEmail;
                await setUserIdSecret(userId);
                this.outputChannel.appendLine(`💾 ✅ FIRST-TIME SETUP: Auto-saved cached email as PostgreSQL userId: ${userId}`);
                
                // Show success notification to user
                vscode.window.showInformationMessage(`🎉 Welcome! Your Cursor email (${userId}) has been detected and set as your User ID.`);
            } else {
                // Fallback to timestamp-based ID if email not found
                const defaultUserId = `user-${Date.now()}`;
                await setUserIdSecret(defaultUserId);
                this.outputChannel.appendLine(`💾 ⚠️  FIRST-TIME SETUP: No cached email found, auto-generated userId: ${defaultUserId}`);
                
                // Show helpful notification to user
                vscode.window.showWarningMessage(`⚠️ Could not detect your Cursor email. Generated temporary ID: ${defaultUserId}. You can change this in settings.`, 'Configure User ID').then(selection => {
                    if (selection === 'Configure User ID') {
                        vscode.commands.executeCommand('cursor-sql-runner.configureUserId');
                    }
                });
            }
        } else {
            this.outputChannel.appendLine(`✅ Using existing userId configuration: ${userId}`);
        }
    }

    /**
     * Auto-detect Cursor database path based on operating system
     * Uses home directory approach - no need for exact username in paths
     */
    private async getAutoDatabasePath(): Promise<string | null> {
        const platform = os.platform();
        const homedir = os.homedir();
        
        // Try macOS path first
        if (platform === 'darwin') {
            const macPath = path.join(homedir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
            if (fs.existsSync(macPath)) {
                this.outputChannel.appendLine(`✅ Found Cursor database at macOS path: ${macPath}`);
                return macPath;
            }
        }
        
        // Try Windows path using home directory
        if (platform === 'win32') {
            const winPath = path.join(homedir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
            if (fs.existsSync(winPath)) {
                this.outputChannel.appendLine(`✅ Found Cursor database at Windows path: ${winPath}`);
                return winPath;
            }
        }
        
        // Try Linux path using home directory
        if (platform === 'linux') {
            const linuxPath = path.join(homedir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
            if (fs.existsSync(linuxPath)) {
                this.outputChannel.appendLine(`✅ Found Cursor database at Linux path: ${linuxPath}`);
                return linuxPath;
            }
        }
        
        this.outputChannel.appendLine(`❌ Cursor database not found in any standard locations`);
        return null;
    }

    /**
     * Initialize database path detection and configuration
     */
    private async initializeDatabasePath(): Promise<void> {
        try {
            const configuredPath = await getDatabasePathSecret();
            
            if (configuredPath && fs.existsSync(configuredPath)) {
                this.outputChannel.appendLine(`✅ Using configured database path: ${configuredPath}`);
                return;
            }
            
            const autoPath = await this.getAutoDatabasePath();
            if (autoPath) {
                await setDatabasePathSecret(autoPath);
                this.outputChannel.appendLine(`💾 Auto-configured database path: ${autoPath}`);
                vscode.window.showInformationMessage(`🎉 Cursor database auto-detected at: ${autoPath}`);
            } else {
                const message = 'Cursor database not found. Please ensure Cursor is installed or configure the database path manually.';
                this.outputChannel.appendLine(`⚠️  ${message}`);
                vscode.window.showWarningMessage(message, 'Configure Manually').then(selection => {
                    if (selection === 'Configure Manually') {
                        vscode.commands.executeCommand('cursor-sql-runner.configureDatabasePath');
                    }
                });
            }
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error during database path initialization: ${error}`);
            console.error('Error during database path initialization:', error);
        }
    }

    /**
     * Initialize extension in proper sequence: database path first, then userId detection
     */
    private async initializeExtension(): Promise<void> {
        try {
            // Step 1: Initialize database path detection
            await this.initializeDatabasePath();
            
            // Step 2: After database is ready, detect and save userId from cached email
            await this.ensureSupabaseUserId();
            
            this.outputChannel.appendLine(`✅ Extension initialization complete`);
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error during extension initialization: ${error}`);
            console.error('Error during extension initialization:', error);
        }
    }

    /**
     * Public method to manually trigger database path detection
     */
    public async detectDatabasePath(): Promise<string | null> {
        return await this.getAutoDatabasePath();
    }

    /**
     * Public method to get the cached email from Cursor database
     */
    public async getCachedEmail(): Promise<string | null> {
        return await this.getCachedEmailFromDatabase();
    }

    /**
     * Public method to get the current userId (cached email or configured value)
     */
    public async getCurrentUserId(): Promise<string> {
        let userId = await getUserIdSecret();
        
        if (!userId) {
            const cachedEmail = await this.getCachedEmailFromDatabase();
            if (cachedEmail) {
                return cachedEmail;
            }
            return `user-${Date.now()}`; // Fallback
        }
        
        return userId;
    }

    /**
     * Public method to manually re-initialize database path (useful for troubleshooting)
     */
    public async reinitializeDatabasePath(): Promise<void> {
        await this.initializeDatabasePath();
    }

    /**
     * Set the default SQL file to the bundled final.sql
     */


    /**
     * Get the optimized SQL query with dynamic timestamp injection and robust exclusion filters
     */
    private getOptimizedQuery(targetTimestamp: string): string {
        // Check if targetTimestamp is already in milliseconds or a timestamp
        let targetMs: number;
        let targetTimestampStr: string;
        
        if (/^\d+$/.test(targetTimestamp)) {
            // It's already milliseconds
            targetMs = parseInt(targetTimestamp);
            targetTimestampStr = new Date(targetMs).toISOString().replace('.000Z', '').replace('Z', '');
        } else {
            // It's a timestamp, convert to milliseconds
            const timestampDate = new Date(targetTimestamp);
            targetMs = timestampDate.getTime();
            targetTimestampStr = targetTimestamp;
        }
        
        return `WITH timestamp_variable AS (
    -- Use actual milliseconds value for accurate comparison
    SELECT ${targetMs} AS target_ms,
           '${targetTimestampStr}' AS target_timestamp
),
-- Filter bubbles that are AFTER the last stored timestamp (strict exclusion)
timestamp_filtered_bubbles AS (
    SELECT
        json_extract(value, '$.bubbleId') AS bubble_id,
        json_extract(value, '$.type') AS type,
        json_extract(value, '$.timingInfo.clientRpcSendTime') AS client_rpc_send_time,
        datetime(
            json_extract(value, '$.timingInfo.clientRpcSendTime')/1000,
            'unixepoch'
        ) AS readable_time
    FROM cursorDiskKV, timestamp_variable
    WHERE key LIKE 'bubbleId:%'
      AND json_extract(value, '$.type') = 2
      AND json_extract(value, '$.timingInfo') IS NOT NULL
      AND json_extract(value, '$.timingInfo.clientRpcSendTime') IS NOT NULL
      -- Use > (strictly greater than) to exclude exact timestamp and all before it
      AND CAST(json_extract(value, '$.timingInfo.clientRpcSendTime') AS INTEGER) > target_ms
      -- Additional safety: exclude records with exact readable timestamp match
      AND datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch') != target_timestamp
),
-- Get all bubbles with their sequence positions
bubble_sequence AS (
    SELECT
        json_extract(cursorDiskKV.value, '$.composerId') AS composer_id,
        json_extract(conversation.value, '$.bubbleId') AS bubble_id,
        json_extract(conversation.value, '$.type') AS type,
        CAST(conversation.key AS INTEGER) AS sequence_index
    FROM cursorDiskKV,
         json_each(json_extract(cursorDiskKV.value, '$.fullConversationHeadersOnly')) AS conversation
    WHERE cursorDiskKV.key LIKE 'composerData:%'
      AND json_extract(cursorDiskKV.value, '$.fullConversationHeadersOnly') IS NOT NULL
),
-- Find target info for all timestamp-filtered bubbles
target_info AS (
    SELECT
        bs.composer_id,
        bs.sequence_index AS target_index,
        bs.bubble_id AS target_bubble_id
    FROM bubble_sequence bs
    JOIN timestamp_filtered_bubbles tfb
      ON bs.bubble_id = tfb.bubble_id
)
SELECT
    tfb.readable_time AS "timestamp",
    (
        SELECT json_extract(bubble_data.value, '$.text')
        FROM cursorDiskKV bubble_data
        WHERE bubble_data.key LIKE 'bubbleId:' || target_bs.composer_id || ':' || prev_bs.bubble_id
    ) AS "prompt"
FROM timestamp_filtered_bubbles tfb
JOIN bubble_sequence target_bs
  ON tfb.bubble_id = target_bs.bubble_id
JOIN target_info ti
  ON target_bs.composer_id = ti.composer_id
 AND target_bs.sequence_index = ti.target_index
LEFT JOIN bubble_sequence prev_bs
  ON prev_bs.composer_id = target_bs.composer_id
 AND prev_bs.sequence_index = (target_bs.sequence_index - 1)
ORDER BY tfb.client_rpc_send_time DESC;`;
    }

    /**
     * Set the interval in minutes
     */
    async setInterval(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter interval in minutes (minimum 1)',
            value: this.intervalMinutes.toString(),
            validateInput: (value) => {
                const num = parseInt(value);
                if (isNaN(num) || num < 1) {
                    return 'Please enter a valid number (minimum 1 minute)';
                }
                return null;
            }
        });

        if (input) {
            this.intervalMinutes = parseInt(input);
            this.saveState();
            this.updateStatusBar();
            
            // If running, restart with new interval
            if (this.isRunning) {
                await this.stop();
                await this.start();
            }
            
            vscode.window.showInformationMessage(`Auto-scheduler interval set to ${this.intervalMinutes} minutes`);
        }
    }

    /**
     * Configure PostgreSQL for the auto-scheduler
     * This should only be called once during first-time setup
     */
    async configurePostgres(silent: boolean = false): Promise<boolean> {
        try {
            // Check if already configured and working
            if (this.postgresManager.isInitialized()) {
                const testConnection = await this.postgresManager.testConnection();
                if (testConnection) {
                    this.outputChannel.appendLine(`✅ PostgreSQL already configured and working`);
                    return true;
                }
            }

            if (!silent) {
                // Show informative message about first-time setup
                const proceed = await vscode.window.showInformationMessage(
                    '🔧 First-time setup: PostgreSQL configuration is required for the auto-scheduler to work properly.',
                    'Configure Now',
                    'Cancel'
                );

                if (proceed !== 'Configure Now') {
                    vscode.window.showWarningMessage('PostgreSQL configuration cancelled. Auto-scheduler will not function properly.');
                    return false;
                }

                const passwordInput = await vscode.window.showInputBox({
                    prompt: 'Enter the extension password to configure PostgreSQL (required once)',
                    password: true,
                    ignoreFocusOut: true,
                    placeHolder: 'Extension password for one-time PostgreSQL setup',
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'Password is required for PostgreSQL configuration';
                        }
                        return null;
                    }
                });

                if (!passwordInput) {
                    vscode.window.showWarningMessage('PostgreSQL configuration cancelled - password is required');
                    return false;
                }

                if (passwordInput.trim() !== 'YorkIEinterns') {
                    vscode.window.showErrorMessage('Incorrect extension password. PostgreSQL configuration aborted.');
                    return false;
                }

                // Show progress during initialization
                const initializePromise = this.postgresManager.initialize();
                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Configuring PostgreSQL...",
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0, message: "Establishing connection..." });
                    return initializePromise;
                });

                const initialized = await initializePromise;
                if (!initialized) {
                    throw new Error('Failed to establish PostgreSQL connection');
                }

                vscode.window.showInformationMessage('✅ PostgreSQL configured successfully! Configuration saved for future use.');
            } else {
                // Silent initialization (already configured before)
                const initialized = await this.postgresManager.initialize();
                if (!initialized) {
                    this.outputChannel.appendLine(`⚠️ PostgreSQL initialization failed - may need reconfiguration`);
                    return false;
                }
            }

            this.outputChannel.appendLine(`✅ PostgreSQL configuration completed and saved`);
            this.outputChannel.appendLine(`🔄 Auto-scheduler will use PostgreSQL for data storage`);
            this.outputChannel.appendLine(`💾 Configuration is persistent - no need to reconfigure`);
            return true;
        } catch (error: any) {
            const errorMessage = error?.message ? error.message : error;
            if (!silent) {
                vscode.window.showErrorMessage(`Failed to configure PostgreSQL: ${errorMessage}`);
            }
            this.outputChannel.appendLine(`❌ PostgreSQL configuration failed: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Start the auto-scheduler
     */
    async start(silent: boolean = false): Promise<void> {
        // Using embedded SQL query - no external file needed
        
        if (this.isRunning) {
            if (!silent) {
                vscode.window.showWarningMessage('Auto-scheduler is already running');
            }
            this.outputChannel.appendLine(`ℹ️ Auto-scheduler is already running`);
            return;
        }

        this.isRunning = true;
        this.updateStatusBar();
        this.saveState();

        // Start the interval
        const intervalMs = this.intervalMinutes * 60 * 1000;
        this.intervalId = setInterval(() => {
            this.executeScheduledTask();
        }, intervalMs);

        this.outputChannel.appendLine(`🚀 Auto-scheduler started!`);
        this.outputChannel.appendLine(`� Using embedded SQL query (no external file needed)`);
        this.outputChannel.appendLine(`⏰ Interval: ${this.intervalMinutes} minutes`);
        this.outputChannel.appendLine(`🔄 Next execution: ${new Date(Date.now() + intervalMs).toLocaleString()}`);
        
        if (!silent) {
            this.outputChannel.show();
        }

        // Execute immediately
        await this.executeScheduledTask();

        if (!silent) {
            vscode.window.showInformationMessage(`Auto-scheduler started! Running every ${this.intervalMinutes} minutes`);
        }
    }

    /**
     * Stop the auto-scheduler
     */
    async stop(silent: boolean = false): Promise<void> {
        if (!this.isRunning) {
            if (!silent) {
                vscode.window.showWarningMessage('Auto-scheduler is not running');
            }
            return;
        }

        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.updateStatusBar();
        this.saveState();

        this.outputChannel.appendLine(`⏹️ Auto-scheduler stopped at ${new Date().toLocaleString()}`);
        this.outputChannel.appendLine(`🔄 Will auto-start when VS Code/Cursor is reopened`);
        
        if (!silent) {
            const message = 'Auto-scheduler stopped (will auto-start when VS Code reopens)';
            
            vscode.window.showInformationMessage(
                message,
                'Show Status',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Show Status') {
                    vscode.commands.executeCommand('cursor-sql-runner.showAutoSchedulerStatus');
                } else if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('cursor-sql-runner.startAutoScheduler');
                }
            });
        }
    }

    /**
     * Toggle the auto-scheduler on/off
     */
    async toggle(): Promise<void> {
        if (this.isRunning) {
            await this.stop();
        } else {
            await this.start();
        }
    }

    /**
     * Execute the scheduled task
     */
    private async executeScheduledTask(): Promise<void> {
        try {
            this.outputChannel.appendLine(`\nExecuting scheduled task at ${new Date().toLocaleString()}`);
            
            // Get last timestamp from PostgreSQL and modify SQL query
            let lastStoredTimestamp: string | null = null;
            const nowIsoString = new Date().toISOString().split('.')[0];
            let timestampToUse = nowIsoString; // Fallback timestamp
            
            try {
                // Show which user we're processing for
                const userId = await getUserIdSecret();
                this.outputChannel.appendLine(`Processing for user: ${userId || 'Not configured'}`);
                
                // Check if PostgreSQL client is initialized
                if (!this.postgresManager.isInitialized()) {
                    this.outputChannel.appendLine(`PostgreSQL client not initialized - using fallback timestamp: ${timestampToUse}`);
                } else {
                    const lastDatapoint = await this.postgresManager.getLastDatapoint();
                    if (lastDatapoint && lastDatapoint.timestamp) {
                        lastStoredTimestamp = lastDatapoint.timestamp;
                        
                        // Find the ACTUAL milliseconds from SQLite for this timestamp
                        if (lastStoredTimestamp) {
                            try {
                                const cleanedStoredTimestamp = lastStoredTimestamp.replace('T', ' ');
                                const findActualMsQuery = `
                                    SELECT json_extract(value, '$.timingInfo.clientRpcSendTime') AS actual_ms
                                    FROM cursorDiskKV 
                                    WHERE key LIKE 'bubbleId:%' 
                                      AND json_extract(value, '$.type') = 2 
                                      AND datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch') = '${cleanedStoredTimestamp}'
                                    ORDER BY json_extract(value, '$.timingInfo.clientRpcSendTime') DESC
                                    LIMIT 1
                                `;
                                
                                const actualMsResult = await this.databaseManager.executeQuery(findActualMsQuery);
                                if (actualMsResult && actualMsResult.length > 0) {
                                    const actualMs = actualMsResult[0].actual_ms;
                                    timestampToUse = actualMs; // Use actual milliseconds directly for SQL query
                                } else {
                                    // Fallback to the stored timestamp if we can't find the exact match
                                    timestampToUse = lastStoredTimestamp.replace(' ', 'T');
                                }
                            } catch (findError) {
                                timestampToUse = lastStoredTimestamp.replace(' ', 'T');
                            }
                        }
                        
                        // Reset retry count on successful fetch
                        this.supabaseRetryCount = 0;
                    } else {
                        this.outputChannel.appendLine(`No previous data found in PostgreSQL - using fallback timestamp`);
                        
                        // Reset retry count on successful connection (even if no data)
                        this.supabaseRetryCount = 0;
                    }
                }
            } catch (timestampError: any) {
                const errorMessage = timestampError.message || timestampError;
                this.outputChannel.appendLine(`Error fetching timestamp from PostgreSQL: ${errorMessage}`);
                
                // STOP and retry - don't proceed if we can't fetch timestamp from PostgreSQL
                if (this.postgresManager.isInitialized()) {
                    this.supabaseRetryCount++;
                    this.outputChannel.appendLine(`Failed to fetch timestamp from PostgreSQL (attempt ${this.supabaseRetryCount}/${this.maxRetries})`);
                    
                    if (this.supabaseRetryCount < this.maxRetries) {
                        this.outputChannel.appendLine(`Will retry in ${this.intervalMinutes} minutes`);
                    } else {
                        this.outputChannel.appendLine(`Max retries reached - using fallback timestamp`);
                        this.outputChannel.appendLine(`Proceeding with fallback, but data might be duplicated`);
                        // Reset retry count for next execution cycle
                        this.supabaseRetryCount = 0;
                    }
                    
                    if (this.supabaseRetryCount < this.maxRetries) {
                        return; // Stop execution here - don't proceed to database query or PostgreSQL push
                    }
                } else {
                    this.outputChannel.appendLine(`PostgreSQL not configured - using fallback timestamp`);
                }
            }

            // Use the new optimized SQL query with dynamic timestamp
            const sqlContent = this.getOptimizedQuery(timestampToUse);

            // Execute the SQL query
            const results = await this.databaseManager.executeQuery(sqlContent);
            
            if (results && results.length > 0) {
                this.outputChannel.appendLine(`Query executed successfully - ${results.length} records returned`);
                
                // Filter out any results that match the last stored timestamp
                const filteredResults = results.filter(result => {
                    // Normalize both timestamps for comparison
                    const resultTimestamp = result.timestamp;
                    const lastTimestamp = timestampToUse;
                    
                    // Convert both to the same format for comparison
                    const resultDate = new Date(resultTimestamp).getTime();
                    const lastDate = new Date(lastTimestamp).getTime();
                    
                    const isMatch = resultDate === lastDate;
                    
                    return !isMatch; // Keep only records that DON'T match the last stored timestamp
                });
                
                this.outputChannel.appendLine(`Filtered out ${results.length - filteredResults.length} duplicate timestamps - ${filteredResults.length} new records to process`);
                
                if (filteredResults.length === 0) {
                    this.outputChannel.appendLine(`No new records to process after filtering`);
                    this.lastExecution = new Date();
                    this.executionCount++;
                    this.updateStatusBar();
                    this.saveState();
                    return;
                }
                
                // Parse and store in PostgreSQL (simple prompts only)
                try {
                    this.outputChannel.appendLine(`Processing results for PostgreSQL storage...`);
                    
                    // Check if PostgreSQL is available for storage
                    if (!this.postgresManager.isInitialized()) {
                        this.outputChannel.appendLine(`PostgreSQL not configured - skipping cloud storage`);
                    } else {
                        // Create results data in the format expected by storeSimplePrompts using filtered results
                        const resultsData = {
                            results: filteredResults,
                            metadata: {
                                query_executed: sqlContent.substring(0, 100) + '...',
                                execution_time_ms: 0, // We don't track execution time in auto-scheduler
                                total_results: filteredResults.length,
                                auto_scheduler: true,
                                execution_timestamp: new Date().toISOString()
                            }
                        };

                        this.outputChannel.appendLine(`Attempting to store ${filteredResults.length} query results to PostgreSQL...`);
                        
                        // Use the same storeSimplePrompts method that parses and stores individual records
                        const stored = await this.postgresManager.storeSimplePrompts(resultsData);
                        
                        if (stored > 0) {
                            this.outputChannel.appendLine(`Successfully stored ${stored} prompts in PostgreSQL`);
                        } else {
                            this.outputChannel.appendLine(`No timestamp-prompt pairs found in results to store`);
                        }
                    }
                    
                } catch (postgresError) {
                    this.outputChannel.appendLine(`Error storing to PostgreSQL: ${postgresError}`);
                }
                
            } else {
                this.outputChannel.appendLine(`Query executed but no results returned`);
            }

            this.lastExecution = new Date();
            this.executionCount++;
            this.updateStatusBar();

            if (this.isRunning) {
                const nextExecution = new Date(Date.now() + (this.intervalMinutes * 60 * 1000));
                this.outputChannel.appendLine(`Next execution: ${nextExecution.toLocaleString()}`);
            }

        } catch (error: any) {
            const errorMessage = error.message || error;
            this.outputChannel.appendLine(`Error executing scheduled task: ${errorMessage}`);
            this.errorCount++;
            this.updateStatusBar();
        }
    }

    /**
     * Get the current status
     */
    getStatus(): {
        isRunning: boolean;
        intervalMinutes: number;
        lastExecution: Date | null;
        executionCount: number;
        errorCount: number;
    } {
        return {
            isRunning: this.isRunning,
            intervalMinutes: this.intervalMinutes,
            lastExecution: this.lastExecution,
            executionCount: this.executionCount,
            errorCount: this.errorCount
        };
    }

    /**
     * Show detailed status information
     */
    async showStatus(): Promise<void> {
        const status = this.getStatus();
        
        const localDbPath = await getDatabasePathSecret() || 'Not configured';
        const userId = await getUserIdSecret() || 'Not configured';
        const { host: postgresHost, port: postgresPort, database: postgresDatabase, tableName: postgresTable } = POSTGRES_DEFAULTS;
        
        const postgresStatus = this.postgresManager.isInitialized() ? '✅ Connected' : '⚠️ Not connected';
        
        // Get auto-startup status
        let autoStartupInfo: string[] = [];
        if (this.autoStartupManager) {
            const autoStatus = this.autoStartupManager.getStatus();
            autoStartupInfo = [
                '',
                '🚀 **AUTO-STARTUP**',
                `🔄 Enabled: ${autoStatus.autoStartupEnabled ? 'Yes' : 'No'}`,
                `🆕 Always Start on Open: ${autoStatus.alwaysStartOnOpen ? 'Yes' : 'No'}`,
                `🔄 Behavior: Start automatically when VS Code/Cursor opens`,
                `⏰ No Timeout: Scheduler can be stopped indefinitely`,
                `🚀 Recovery: Only on VS Code/Cursor restart`,
            ];
        }

        const statusText = [
            '📊 Prompt Sync Status',
            '',
            '⚡ **SCHEDULER**',
            `🟢 Running: ${status.isRunning ? 'Yes' : 'No'}`,
            `📂 SQL Query: Embedded (Built-in)`,
            `⏰ Interval: ${status.intervalMinutes} minutes`,
            `📈 Executions: ${status.executionCount}`,
            `❌ Errors: ${status.errorCount}`,
            `🕒 Last Execution: ${status.lastExecution ? status.lastExecution.toLocaleString() : 'Never'}`,
            ...autoStartupInfo,
            '',
            '🗄️ **DATABASES**',
            `📂 Local Source: ${localDbPath === 'Not configured' ? '❌ Not configured' : '✅ Configured'}`,
            `🐘 PostgreSQL Status: ${postgresStatus}`,
            `🏠 Host: ${postgresHost}:${postgresPort}`,
            `📋 Database: ${postgresDatabase}`,
            `📋 Table: ${postgresTable}`,
            `👤 User ID: ${userId}`,
        ];

        if (status.isRunning) {
            const nextExecution = new Date(Date.now() + (status.intervalMinutes * 60 * 1000));
            statusText.push('', `⏰ **NEXT EXECUTION**`, `${nextExecution.toLocaleString()}`);
        }

        const message = statusText.join('\n');
        
        // Show in both information message and output channel
        vscode.window.showInformationMessage('Auto-Scheduler status displayed in output channel', 'Show Details')
            .then(selection => {
                if (selection === 'Show Details') {
                    this.outputChannel.show();
                }
            });
        
        this.outputChannel.appendLine('\n' + message);
        this.outputChannel.show();
    }

    /**
     * Update the status bar
     */
    private updateStatusBar(): void {
        if (this.isRunning) {
            const retryIndicator = this.supabaseRetryCount > 0 ? ` (retry ${this.supabaseRetryCount}/${this.maxRetries})` : '';
            this.statusBarItem.text = `$(clock) Auto-Schedule (${this.intervalMinutes}m) [${this.executionCount}/${this.errorCount}]${retryIndicator}`;
            this.statusBarItem.backgroundColor = this.supabaseRetryCount > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
            this.statusBarItem.tooltip = `Auto-scheduler running every ${this.intervalMinutes} minutes\nExecutions: ${this.executionCount}, Errors: ${this.errorCount}\nPostgreSQL retries: ${this.supabaseRetryCount}/${this.maxRetries}\nClick to stop`;
        } else {
            this.statusBarItem.text = `$(clock) Auto-Schedule (Off)`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            
            let tooltipText = `Auto-scheduler stopped\nClick to restart immediately`;
            if (this.autoStartupManager) {
                const status = this.autoStartupManager.getStatus();
                tooltipText += `\n🆕 Will auto-start on next VS Code/Cursor launch`;
                if (status.autoStartupEnabled) {
                    tooltipText += `\n✅ Auto-startup: ALWAYS ON`;
                }
            }
            this.statusBarItem.tooltip = tooltipText;
        }
    }

    /**
     * Save state to workspace storage
     */
    private saveState(): void {
        this.context.globalState.update('autoScheduler.intervalMinutes', this.intervalMinutes);
        
        this.context.workspaceState.update('autoScheduler.isRunning', this.isRunning);
        this.context.workspaceState.update('autoScheduler.executionCount', this.executionCount);
        this.context.workspaceState.update('autoScheduler.errorCount', this.errorCount);
        this.context.workspaceState.update('autoScheduler.lastExecution', this.lastExecution?.toISOString());
    }

    /**
     * Restore state from workspace storage
     */
    private restoreState(): void {
        this.intervalMinutes = this.context.globalState.get('autoScheduler.intervalMinutes', 60);
        
        // Restore session-specific data from workspace state
        this.executionCount = this.context.workspaceState.get('autoScheduler.executionCount', 0);
        this.errorCount = this.context.workspaceState.get('autoScheduler.errorCount', 0);
        
        const lastExecutionStr = this.context.workspaceState.get('autoScheduler.lastExecution', null);
        if (lastExecutionStr) {
            this.lastExecution = new Date(lastExecutionStr);
        }

        // Store the previous running state - we'll use this for auto-restart
        const wasRunning = this.context.workspaceState.get('autoScheduler.isRunning', false);
        this.isRunning = false; // Always start as stopped, then auto-restart if needed
        
        // Store for later auto-restart decision
        this.context.workspaceState.update('autoScheduler.wasRunning', wasRunning);
    }

    /**
     * Check if auto-restart should happen (called from extension.ts after setup)
     */
    public shouldAutoRestart(): boolean {
        return this.context.workspaceState.get('autoScheduler.wasRunning', false);
    }

    /**
     * Clear the auto-restart flag (called after successful restart)
     */
    public clearAutoRestartFlag(): void {
        this.context.workspaceState.update('autoScheduler.wasRunning', false);
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.statusBarItem.dispose();
        this.outputChannel.dispose();
    }
}
