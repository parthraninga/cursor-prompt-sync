import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface QueryResult {
    [key: string]: any;
}

export class DatabaseManager {
    private sql: any;
    private sqlInitialized: boolean = false;
    private initializationPromise: Promise<void>;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Cursor Prompt Sync - Database Manager');
        this.initializationPromise = this.initializeSQL();
    }

    private async initializeSQL() {
        try {
            this.outputChannel.appendLine('🔄 [DB MANAGER] Starting sql.js initialization...');
            // Dynamically import sql.js for cross-platform SQLite support
            const initSqlJs = require('sql.js');
            this.outputChannel.appendLine('🔄 [DB MANAGER] sql.js module loaded, initializing...');
            this.sql = await initSqlJs();
            this.sqlInitialized = true;
            this.outputChannel.appendLine('✅ [DB MANAGER] sql.js initialized successfully');
        } catch (error) {
            this.outputChannel.appendLine(`❌ [DB MANAGER] sql.js not available, using fallback implementation: ${error}`);
            this.sql = null;
            this.sqlInitialized = false;
        }
    }

    async executeQuery(query: string, cancellationToken?: vscode.CancellationToken): Promise<QueryResult[]> {
        // Wait for SQL initialization to complete
        this.outputChannel.appendLine('🔄 [DB MANAGER] Waiting for SQL initialization...');
        await this.initializationPromise;
        this.outputChannel.appendLine(`🔄 [DB MANAGER] SQL initialization complete. sqlInitialized: ${this.sqlInitialized}, sql: ${this.sql ? 'available' : 'null'}`);
        
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const databasePath = config.get<string>('databasePath', '');
        
        this.outputChannel.appendLine(`🔄 [DB MANAGER] Database path: ${databasePath}`);
        
        if (!databasePath) {
            throw new Error('Database path not configured. Please set the Cursor database path first.');
        }

        if (!fs.existsSync(databasePath)) {
            throw new Error(`Database file not found: ${databasePath}`);
        }

        this.outputChannel.appendLine(`🔄 [DB MANAGER] Database file exists, checking query...`);

        // Validate query (only allow SELECT for safety)
        const trimmedQuery = query.trim().toLowerCase();
        if (!trimmedQuery.startsWith('select') && !trimmedQuery.startsWith('with')) {
            throw new Error('Only SELECT and WITH queries are allowed for safety');
        }

        this.outputChannel.appendLine(`🔄 [DB MANAGER] Query validation passed, executing...`);

        try {
            if (this.sqlInitialized && this.sql) {
                this.outputChannel.appendLine('🔧 [DB MANAGER] Using sql.js to execute SQLite query');
                // Use sql.js to read SQLite database
                return await this.executeSQLiteQuery(databasePath, query);
            } else {
                this.outputChannel.appendLine('⚠️ [DB MANAGER] sql.js not available, using fallback implementation');
                // Fallback for specific queries
                if (trimmedQuery.includes('itemtable') && trimmedQuery.includes('cursorauth/cachedemail')) {
                    this.outputChannel.appendLine('📧 [DB MANAGER] Using email fallback for ItemTable query');
                    return this.getCachedEmailFallback();
                }
                
                // For conversation queries, try to parse the database manually
                if (trimmedQuery.includes('conversations') || trimmedQuery.includes('message')) {
                    this.outputChannel.appendLine('💬 [DB MANAGER] Using manual parsing for conversation query');
                    return await this.parseConversationData(databasePath, query);
                }
                
                this.outputChannel.appendLine('📭 [DB MANAGER] No specific fallback available, returning empty array');
                return [];
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`❌ [DB MANAGER] DatabaseManager error: ${error.message}`);
            this.outputChannel.appendLine(`❌ [DB MANAGER] Error stack: ${error.stack}`);
            // Fallback to mock data if database reading fails
            if (trimmedQuery.includes('itemtable') && trimmedQuery.includes('cursorauth/cachedemail')) {
                this.outputChannel.appendLine('📧 [DB MANAGER] Using email fallback due to database error');
                return this.getCachedEmailFallback();
            }
            return [];
        }
    }

    private async executeSQLiteQuery(databasePath: string, query: string): Promise<QueryResult[]> {
        try {
            this.outputChannel.appendLine(`🔄 [SQLITE] Starting SQLite query execution...`);
            this.outputChannel.appendLine(`🔄 [SQLITE] Database path: ${databasePath}`);
            this.outputChannel.appendLine(`🔄 [SQLITE] Query: ${query.trim()}`);
            
            // Read the SQLite database file
            this.outputChannel.appendLine(`🔄 [SQLITE] Reading database file...`);
            const dbBuffer = fs.readFileSync(databasePath);
            this.outputChannel.appendLine(`🔄 [SQLITE] Database file read successfully, size: ${dbBuffer.length} bytes`);
            
            this.outputChannel.appendLine(`🔄 [SQLITE] Creating sql.js Database instance...`);
            const db = new this.sql.Database(dbBuffer);
            this.outputChannel.appendLine(`🔄 [SQLITE] Database instance created successfully`);
            
            // Execute the query
            this.outputChannel.appendLine(`🔄 [SQLITE] Preparing SQL statement...`);
            const stmt = db.prepare(query);
            this.outputChannel.appendLine(`🔄 [SQLITE] Statement prepared successfully`);
            
            const results: QueryResult[] = [];
            let rowCount = 0;
            
            this.outputChannel.appendLine(`🔄 [SQLITE] Executing query and collecting results...`);
            while (stmt.step()) {
                const row = stmt.getAsObject();
                results.push(row);
                rowCount++;
                this.outputChannel.appendLine(`🔄 [SQLITE] Row ${rowCount}: ${JSON.stringify(row)}`);
                
                // Limit logging to first 5 rows to avoid spam
                if (rowCount <= 5) {
                    this.outputChannel.appendLine(`🔄 [SQLITE] Row ${rowCount} details: ${JSON.stringify(row, null, 2)}`);
                }
            }
            
            this.outputChannel.appendLine(`✅ [SQLITE] Query execution completed. Total rows: ${rowCount}`);
            
            stmt.free();
            db.close();
            this.outputChannel.appendLine(`🔄 [SQLITE] Database connection closed`);
            
            return results;
        } catch (error: any) {
            this.outputChannel.appendLine(`❌ [SQLITE] SQLite query execution failed: ${error.message}`);
            this.outputChannel.appendLine(`❌ [SQLITE] Error stack: ${error.stack}`);
            this.outputChannel.appendLine(`❌ [SQLITE] Error details: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
            throw new Error(`SQLite query execution failed: ${error.message}`);
        }
    }

    private async parseConversationData(databasePath: string, query: string): Promise<QueryResult[]> {
        try {
            // Try to extract conversation data manually by reading the database file
            const dbBuffer = fs.readFileSync(databasePath);
            const dbContent = dbBuffer.toString('utf8', 0, Math.min(dbBuffer.length, 1000000)); // Read first 1MB
            
            // Look for conversation patterns in the database
            const results: QueryResult[] = [];
            
            // Try to find JSON-like patterns that might contain conversation data
            const jsonMatches = dbContent.match(/\{[^}]*"timestamp"[^}]*\}/g) || [];
            
            for (const match of jsonMatches.slice(0, 100)) { // Limit to first 100 matches
                try {
                    const parsed = JSON.parse(match);
                    if (parsed.timestamp && parsed.prompt) {
                        results.push({
                            timestamp: parsed.timestamp,
                            prompt: parsed.prompt,
                            user_id: parsed.user_id || 'unknown'
                        });
                    }
                } catch (e) {
                    // Skip invalid JSON
                }
            }
            
            return results;
        } catch (error: any) {
            console.log(`Manual parsing failed: ${error.message}`);
            return [];
        }
    }

    private getCachedEmailFallback(): QueryResult[] {
        // Try to get email from VS Code configuration first
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const userId = config.get<string>('userId', '');
        
        this.outputChannel.appendLine(`📧 [FALLBACK] getCachedEmailFallback: Current userId in config: "${userId}"`);
        
        if (userId && userId.includes('@') && !userId.includes('user@example.com') && !userId.startsWith('user-')) {
            this.outputChannel.appendLine(`✅ [FALLBACK] Using configured userId as email: ${userId}`);
            return [{ key: 'cursorAuth/cachedEmail', value: userId }];
        }
        
        this.outputChannel.appendLine(`⚠️ [FALLBACK] No valid email found in userId config, using default fallback`);
        return [{ key: 'cursorAuth/cachedEmail', value: 'user@example.com' }];
    }

    async testConnection(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const databasePath = config.get<string>('databasePath', '');
        
        if (!databasePath) {
            return false;
        }

        return fs.existsSync(databasePath);
    }

    async getDatabaseInfo(): Promise<{ tables: string[], size: number, recordCount: number }> {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const databasePath = config.get<string>('databasePath', '');

        if (!databasePath || !fs.existsSync(databasePath)) {
            throw new Error('Database not found');
        }

        try {
            // Get database file size
            const stats = fs.statSync(databasePath);
            const size = stats.size;

            // Mock data for cross-platform compatibility
            const tables = ['ItemTable', 'cursorDiskKV', 'sqlite_master'];
            const recordCount = 0;

            return { tables, size, recordCount };
        } catch (error) {
            throw new Error(`Failed to get database info: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getTableSchema(tableName: string): Promise<QueryResult[]> {
        // Mock implementation for cross-platform compatibility
        return [
            { cid: 0, name: 'key', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
            { cid: 1, name: 'value', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 }
        ];
    }

    async getSampleData(tableName: string, limit: number = 5): Promise<QueryResult[]> {
        // Mock implementation for cross-platform compatibility
        return [];
    }

    async close(): Promise<void> {
        // No-op since we're not maintaining persistent connections
        return Promise.resolve();
    }

    dispose() {
        // No-op since we don't have native connections to dispose
    }
}
