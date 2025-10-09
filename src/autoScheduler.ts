import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseManager } from './databaseManager';
import { ResultsViewer } from './resultsViewer';
import { PostgresManager } from './postgresManager';

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
        private context: vscode.ExtensionContext
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
            this.outputChannel.appendLine(`🔍 Executing query: SELECT value FROM ItemTable WHERE key = 'cursorAuth/cachedEmail'`);
            
            // Query the ItemTable for cursorAuth/cachedEmail
            const emailQuery = `
                SELECT value 
                FROM ItemTable 
                WHERE key = 'cursorAuth/cachedEmail'
                LIMIT 1;
            `;
            
            const results = await this.databaseManager.executeQuery(emailQuery);
            
            if (results && results.length > 0 && results[0].value) {
                const email = results[0].value;
                this.outputChannel.appendLine(`✅ SUCCESS: Found cached email in ItemTable: ${email}`);
                console.log(`✅ SUCCESS: Found cached email in ItemTable: ${email}`);
                return email;
            } else {
                this.outputChannel.appendLine(`❌ EMPTY RESULT: No cached email found in ItemTable (results: ${JSON.stringify(results)})`);
                console.log(`❌ EMPTY RESULT: No cached email found in ItemTable`);
                return null;
            }
        } catch (error) {
            this.outputChannel.appendLine(`❌ QUERY ERROR: Failed to query cached email from database: ${error}`);
            console.log(`❌ QUERY ERROR: Failed to query cached email from database: ${error}`);
            return null;
        }
    }

    /**
     * Ensure userId exists for PostgreSQL operations using cached email from database
     */
    private async ensureSupabaseUserId(): Promise<void> {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        let userId = config.get<string>('userId', '');
        
        // If no user ID is configured, this is first-time setup
        if (!userId) {
            this.outputChannel.appendLine(`🔍 First-time setup detected - querying Cursor database for cached email...`);
            
            // Run the email detection query
            const cachedEmail = await this.getCachedEmailFromDatabase();
            if (cachedEmail) {
                userId = cachedEmail;
                await config.update('userId', userId, vscode.ConfigurationTarget.Global);
                this.outputChannel.appendLine(`💾 ✅ FIRST-TIME SETUP: Auto-saved cached email as PostgreSQL userId: ${userId}`);
                console.log(`💾 ✅ FIRST-TIME SETUP: Auto-saved cached email as PostgreSQL userId: ${userId}`);
                
                // Show success notification to user
                vscode.window.showInformationMessage(`🎉 Welcome! Your Cursor email (${userId}) has been detected and set as your User ID.`);
            } else {
                // Fallback to timestamp-based ID if email not found
                const defaultUserId = `user-${Date.now()}`;
                await config.update('userId', defaultUserId, vscode.ConfigurationTarget.Global);
                this.outputChannel.appendLine(`💾 ⚠️  FIRST-TIME SETUP: No cached email found, auto-generated userId: ${defaultUserId}`);
                console.log(`💾 ⚠️  FIRST-TIME SETUP: No cached email found, auto-generated userId: ${defaultUserId}`);
                
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
                console.log(`✅ Found Cursor database at macOS path: ${macPath}`);
                return macPath;
            }
        }
        
        // Try Windows path using home directory
        if (platform === 'win32') {
            const winPath = path.join(homedir, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
            if (fs.existsSync(winPath)) {
                this.outputChannel.appendLine(`✅ Found Cursor database at Windows path: ${winPath}`);
                console.log(`✅ Found Cursor database at Windows path: ${winPath}`);
                return winPath;
            }
        }
        
        // Try Linux path using home directory
        if (platform === 'linux') {
            const linuxPath = path.join(homedir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
            if (fs.existsSync(linuxPath)) {
                this.outputChannel.appendLine(`✅ Found Cursor database at Linux path: ${linuxPath}`);
                console.log(`✅ Found Cursor database at Linux path: ${linuxPath}`);
                return linuxPath;
            }
        }
        
        this.outputChannel.appendLine(`❌ Cursor database not found in any standard locations`);
        console.log(`❌ Cursor database not found in any standard locations`);
        return null;
    }

    /**
     * Initialize database path detection and configuration
     */
    private async initializeDatabasePath(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('cursorSqlRunner');
            const configuredPath = config.get<string>('databasePath', '');
            
            // If user has configured a path and it exists, we're good
            if (configuredPath && fs.existsSync(configuredPath)) {
                this.outputChannel.appendLine(`✅ Using configured database path: ${configuredPath}`);
                return;
            }
            
            // Try auto-detection
            const autoPath = await this.getAutoDatabasePath();
            if (autoPath) {
                // Auto-save the detected path for future use
                await config.update('databasePath', autoPath, vscode.ConfigurationTarget.Global);
                this.outputChannel.appendLine(`💾 Auto-configured database path: ${autoPath}`);
                vscode.window.showInformationMessage(`🎉 Cursor database auto-detected at: ${autoPath}`);
            } else {
                // Show helpful message to user
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
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        let userId = config.get<string>('userId', '');
        
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
        return `WITH timestamp_variable AS (
    -- Declare the timestamp variable for easy editing
    SELECT '${targetTimestamp}' AS target_timestamp
),
-- Convert timestamp to milliseconds for comparison
timestamp_milliseconds AS (
    SELECT 
        target_timestamp,
        strftime('%s', target_timestamp) * 1000 AS target_ms
    FROM timestamp_variable
),
-- First, get all bubble IDs after the specified timestamp (EXCLUDING exact match)
timestamp_filtered_bubbles AS (
    SELECT
        json_extract(value, '$.bubbleId') AS bubble_id,
        json_extract(value, '$.type') AS type,
        json_extract(value, '$.timingInfo.clientRpcSendTime') AS client_rpc_send_time,
        datetime(
            json_extract(value, '$.timingInfo.clientRpcSendTime')/1000,
            'unixepoch'
        ) AS readable_time
    FROM cursorDiskKV, timestamp_milliseconds
    WHERE key LIKE 'bubbleId:%'
      AND json_extract(value, '$.type') = 2
      AND json_extract(value, '$.timingInfo') IS NOT NULL
      AND json_extract(value, '$.timingInfo.clientRpcSendTime') IS NOT NULL
      AND json_extract(value, '$.timingInfo.clientRpcSendTime') > timestamp_milliseconds.target_ms
      AND json_extract(value, '$.timingInfo.clientRpcSendTime') != timestamp_milliseconds.target_ms
      -- Additional time-based exclusions
      AND datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch') != timestamp_milliseconds.target_timestamp
      AND datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch') != REPLACE(timestamp_milliseconds.target_timestamp, 'T', ' ')
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
FROM timestamp_filtered_bubbles tfb, timestamp_milliseconds
JOIN bubble_sequence target_bs
  ON tfb.bubble_id = target_bs.bubble_id
JOIN target_info ti
  ON target_bs.composer_id = ti.composer_id
 AND target_bs.sequence_index = ti.target_index
LEFT JOIN bubble_sequence prev_bs
  ON prev_bs.composer_id = target_bs.composer_id
 AND prev_bs.sequence_index = (target_bs.sequence_index - 1)
-- Multi-layer exclusion filters using dynamic timestamp
WHERE tfb.client_rpc_send_time > timestamp_milliseconds.target_ms
  AND tfb.client_rpc_send_time != timestamp_milliseconds.target_ms
  AND tfb.readable_time != timestamp_milliseconds.target_timestamp
  AND tfb.readable_time != REPLACE(timestamp_milliseconds.target_timestamp, 'T', ' ')
  AND tfb.readable_time NOT LIKE timestamp_milliseconds.target_timestamp || '%'
  AND tfb.readable_time NOT LIKE REPLACE(timestamp_milliseconds.target_timestamp, 'T', ' ') || '%'
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
     */
    async configurePostgres(silent: boolean = false): Promise<void> {
        try {
            await this.postgresManager.initialize();
            if (!silent) {
                vscode.window.showInformationMessage('PostgreSQL configured successfully for auto-scheduler');
            }
            this.outputChannel.appendLine(`✅ PostgreSQL configuration completed`);
            this.outputChannel.appendLine(`🔄 Auto-scheduler will now use PostgreSQL for incremental processing`);
        } catch (error) {
            if (!silent) {
                vscode.window.showErrorMessage(`Failed to configure PostgreSQL: ${error}`);
            }
            this.outputChannel.appendLine(`❌ PostgreSQL configuration failed: ${error}`);
            throw error;
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
    async stop(): Promise<void> {
        if (!this.isRunning) {
            vscode.window.showWarningMessage('Auto-scheduler is not running');
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
        vscode.window.showInformationMessage('Auto-scheduler stopped');
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
            this.outputChannel.appendLine(`\n🔄 Executing scheduled task at ${new Date().toLocaleString()}`);
            
            // Get last timestamp from PostgreSQL and modify SQL query
            let lastStoredTimestamp: string | null = null;
            let timestampToUse = '2025-09-01T10:50:15'; // Fallback timestamp
            
            try {
                // Show which user we're processing for
                const config = vscode.workspace.getConfiguration('cursorSqlRunner');
                const userId = config.get<string>('userId', '');
                this.outputChannel.appendLine(`👤 Processing for user: ${userId || 'Not configured'}`);
                this.outputChannel.appendLine(`🔍 Fetching last stored timestamp from PostgreSQL...`);
                
                // Check if PostgreSQL client is initialized
                if (!this.postgresManager.isInitialized()) {
                    this.outputChannel.appendLine(`⚠️ PostgreSQL client not initialized`);
                    this.outputChannel.appendLine(`💡 To enable PostgreSQL integration:`);
                    this.outputChannel.appendLine(`   1. Open Command Palette (Ctrl+Shift+P)`);
                    this.outputChannel.appendLine(`   2. Run "Cursor SQL: Configure PostgreSQL"`);
                    this.outputChannel.appendLine(`   3. Enter your PostgreSQL connection details`);
                    this.outputChannel.appendLine(`🔄 Using fallback timestamp: ${timestampToUse}`);
                } else {
                    const lastDatapoint = await this.postgresManager.getLastDatapoint();
                    if (lastDatapoint && lastDatapoint.timestamp) {
                        lastStoredTimestamp = lastDatapoint.timestamp;
                        
                        // Use the stored timestamp, handling both clean and ISO formats
                        if (lastStoredTimestamp) {
                            // Strip any timezone information first
                            const cleanedTimestamp = lastStoredTimestamp
                                .replace(/\+\d{2}:\d{2}$/, '')  // Remove +00:00, +05:30, etc.
                                .replace(/Z$/, '')              // Remove Z
                                .replace(/\.\d{3}Z?$/, '')      // Remove .000Z or .123
                                .replace(/\.\d{3}\+\d{2}:\d{2}$/, ''); // Remove .000+00:00
                            
                            // Check if timestamp is in clean format (YYYY-MM-DD HH:MM:SS)
                            if (cleanedTimestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
                                // Convert to T format for SQL query compatibility (YYYY-MM-DDTHH:MM:SS)
                                timestampToUse = cleanedTimestamp.replace(' ', 'T');
                                this.outputChannel.appendLine(`🔄 Using clean format timestamp directly for query`);
                            } else if (cleanedTimestamp.includes('T')) {
                                // Handle ISO format - use the cleaned timestamp directly
                                timestampToUse = cleanedTimestamp; // Already cleaned of timezone info
                                this.outputChannel.appendLine(`🔄 Cleaned ISO timestamp: "${lastStoredTimestamp}" → "${timestampToUse}"`);
                            } else {
                                // Handle other formats by parsing and formatting consistently  
                                const date = new Date(lastStoredTimestamp);
                                const year = date.getFullYear();
                                const month = String(date.getMonth() + 1).padStart(2, '0');
                                const day = String(date.getDate()).padStart(2, '0');
                                const hours = String(date.getHours()).padStart(2, '0');
                                const minutes = String(date.getMinutes()).padStart(2, '0');
                                const seconds = String(date.getSeconds()).padStart(2, '0');
                                timestampToUse = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
                                this.outputChannel.appendLine(`🔄 Converted unknown format to local time`);
                            }
                        }
                        this.outputChannel.appendLine(`✅ Last stored timestamp from PostgreSQL: ${lastStoredTimestamp}`);
                        this.outputChannel.appendLine(`✅ Final timestamp for SQL query: ${timestampToUse}`);
                        this.outputChannel.appendLine(`📊 Last stored prompt preview: "${lastDatapoint.prompt?.substring(0, 100)}..."`);
                        
                        // Reset retry count on successful fetch
                        this.supabaseRetryCount = 0;
                    } else {
                        this.outputChannel.appendLine(`ℹ️ No previous data found in PostgreSQL - using fallback timestamp: ${timestampToUse}`);
                        
                        // Reset retry count on successful connection (even if no data)
                        this.supabaseRetryCount = 0;
                    }
                }
            } catch (timestampError: any) {
                const errorMessage = timestampError.message || timestampError;
                this.outputChannel.appendLine(`⚠️ Error fetching timestamp from PostgreSQL: ${errorMessage}`);
                
                // STOP and retry - don't proceed if we can't fetch timestamp from PostgreSQL
                if (this.postgresManager.isInitialized()) {
                    this.supabaseRetryCount++;
                    this.outputChannel.appendLine(`❌ Failed to fetch timestamp from PostgreSQL (attempt ${this.supabaseRetryCount}/${this.maxRetries})`);
                    
                    if (this.supabaseRetryCount < this.maxRetries) {
                        this.outputChannel.appendLine(`🔄 Will retry in ${this.intervalMinutes} minutes`);
                    } else {
                        this.outputChannel.appendLine(`❌ Max retries reached - using fallback timestamp: ${timestampToUse}`);
                        this.outputChannel.appendLine(`⚠️ Proceeding with fallback, but data might be duplicated`);
                        // Reset retry count for next execution cycle
                        this.supabaseRetryCount = 0;
                    }
                    
                    if (this.supabaseRetryCount < this.maxRetries) {
                        return; // Stop execution here - don't proceed to database query or PostgreSQL push
                    }
                } else {
                    this.outputChannel.appendLine(`🔄 PostgreSQL not configured - using fallback timestamp: ${timestampToUse}`);
                }
            }

            // Use the new optimized SQL query with dynamic timestamp
            const sqlContent = this.getOptimizedQuery(timestampToUse);
            this.outputChannel.appendLine(`🔧 Using optimized SQL query with timestamp: ${timestampToUse}`);
            


            // Execute the SQL query
            const results = await this.databaseManager.executeQuery(sqlContent);
            
            if (results && results.length > 0) {
                this.outputChannel.appendLine(`✅ Query executed successfully - ${results.length} records returned`);
                
                // Skip local JSON export - only store to PostgreSQL
                
                // Parse and store in PostgreSQL (simple prompts only)
                try {
                    this.outputChannel.appendLine(`🔄 Processing results for PostgreSQL storage...`);
                    
                    // Check if PostgreSQL is available for storage
                    if (!this.postgresManager.isInitialized()) {
                        this.outputChannel.appendLine(`⚠️ PostgreSQL not configured - skipping cloud storage`);
                        this.outputChannel.appendLine(`💡 Configure PostgreSQL to enable automatic storage:`);
                        this.outputChannel.appendLine(`   Command: "Cursor SQL: Configure PostgreSQL"`);
                    } else {
                        // Create results data in the format expected by storeSimplePrompts
                        const resultsData = {
                            results: results,
                            metadata: {
                                query_executed: sqlContent.substring(0, 100) + '...',
                                execution_time_ms: 0, // We don't track execution time in auto-scheduler
                                total_results: results.length,
                                auto_scheduler: true,
                                execution_timestamp: new Date().toISOString()
                            }
                        };

                        this.outputChannel.appendLine(`📝 Attempting to store ${results.length} query results to PostgreSQL...`);
                        
                        // Use the same storeSimplePrompts method that parses and stores individual records
                        const stored = await this.postgresManager.storeSimplePrompts(resultsData);
                        
                        if (stored > 0) {
                            this.outputChannel.appendLine(`✅ Successfully stored ${stored} prompts in PostgreSQL`);
                            
                            // Show summary - look at the actual result structure
                            this.outputChannel.appendLine(`📊 Sample of processed results:`);
                            const sampleResults = results.slice(0, 3);
                            sampleResults.forEach((result, index) => {
                                const timestamp = result.timestamp || 'No timestamp';
                                const prompt = result.prompt || 'No prompt';
                                this.outputChannel.appendLine(`   ${index + 1}. [${timestamp}] "${typeof prompt === 'string' ? prompt.substring(0, 80) : JSON.stringify(prompt).substring(0, 80)}..."`);
                            });
                        } else {
                            this.outputChannel.appendLine(`ℹ️ No timestamp-prompt pairs found in results to store`);
                            
                            // Debug: Show result structure
                            if (results.length > 0) {
                                this.outputChannel.appendLine(`� Debug - First result structure: ${JSON.stringify(Object.keys(results[0]))}`);
                                this.outputChannel.appendLine(`🔍 Debug - First result sample: ${JSON.stringify(results[0]).substring(0, 200)}...`);
                            }
                        }
                    }
                    
                } catch (postgresError) {
                    this.outputChannel.appendLine(`⚠️ Error storing to PostgreSQL: ${postgresError}`);
                }
                
            } else {
                this.outputChannel.appendLine(`ℹ️ Query executed but no results returned`);
            }

            this.lastExecution = new Date();
            this.executionCount++;
            this.updateStatusBar();

            if (this.isRunning) {
                const nextExecution = new Date(Date.now() + (this.intervalMinutes * 60 * 1000));
                this.outputChannel.appendLine(`⏰ Next execution: ${nextExecution.toLocaleString()}`);
            }

        } catch (error: any) {
            const errorMessage = error.message || error;
            this.outputChannel.appendLine(`❌ Error executing scheduled task: ${errorMessage}`);
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
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        
        // Get database configuration info
        const localDbPath = config.get<string>('databasePath') || 'Not configured';
        const postgresHost = config.get<string>('postgresHost') || '3.108.9.100';
        const postgresPort = config.get<number>('postgresPort') || 5432;
        const postgresDatabase = config.get<string>('postgresDatabase') || 'Not configured';
        const postgresTable = config.get<string>('postgresTableName') || 'cursor_query_results';
        const userId = config.get<string>('userId') || 'Not configured';
        
        // Check PostgreSQL connection status
        let postgresStatus = 'Not initialized';
        if (this.postgresManager.isInitialized()) {
            postgresStatus = '✅ Connected';
        } else if (postgresDatabase !== 'Not configured') {
            postgresStatus = '⚠️ Configured but not connected';
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
            this.statusBarItem.tooltip = `Auto-scheduler stopped\nClick to start`;
        }
    }

    /**
     * Save state to workspace storage
     */
    private saveState(): void {
        // Save settings globally so they work across all workspaces
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        config.update('autoSchedulerInterval', this.intervalMinutes, vscode.ConfigurationTarget.Global);
        
        // These can remain in workspace state as they're session-specific
        this.context.workspaceState.update('autoScheduler.isRunning', this.isRunning);
        this.context.workspaceState.update('autoScheduler.executionCount', this.executionCount);
        this.context.workspaceState.update('autoScheduler.errorCount', this.errorCount);
        this.context.workspaceState.update('autoScheduler.lastExecution', this.lastExecution?.toISOString());
    }

    /**
     * Restore state from workspace storage
     */
    private restoreState(): void {
        // Restore interval from global configuration (works across all workspaces)
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        this.intervalMinutes = config.get<number>('autoSchedulerInterval', 60);
        
        // Restore session-specific data from workspace state
        this.executionCount = this.context.workspaceState.get('autoScheduler.executionCount', 0);
        this.errorCount = this.context.workspaceState.get('autoScheduler.errorCount', 0);
        
        const lastExecutionStr = this.context.workspaceState.get('autoScheduler.lastExecution', null);
        if (lastExecutionStr) {
            this.lastExecution = new Date(lastExecutionStr);
        }

        // Don't automatically restart - user needs to manually start
        this.isRunning = false;
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
