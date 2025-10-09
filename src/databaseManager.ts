import * as vscode from 'vscode';
import * as fs from 'fs';

const sqlite3 = require('sqlite3').verbose();

export interface QueryResult {
    [key: string]: any;
}

export class DatabaseManager {
    private db: any = null;

    constructor() {}

    async executeQuery(query: string, cancellationToken?: vscode.CancellationToken): Promise<QueryResult[]> {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const databasePath = config.get<string>('databasePath', '');
        const maxRows = config.get<number>('maxRows', 1000);
        const timeout = config.get<number>('queryTimeout', 30000);

        // Validate query (only allow SELECT for safety)
        const trimmedQuery = query.trim().toLowerCase();
        if (!trimmedQuery.startsWith('select') && !trimmedQuery.startsWith('with')) {
            throw new Error('Only SELECT and WITH queries are allowed for safety');
        }

        return new Promise((resolve, reject) => {
            // Open database connection
            this.db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, (err: Error | null) => {
                if (err) {
                    reject(new Error(`Failed to open database: ${err.message}`));
                    return;
                }
            });

            const results: QueryResult[] = [];
            
            // Set timeout
            const timeoutId = setTimeout(() => {
                if (this.db) {
                    this.db.close();
                }
                reject(new Error(`Query timeout after ${timeout}ms`));
            }, timeout);

            // Handle cancellation
            const cancellationListener = cancellationToken?.onCancellationRequested(() => {
                clearTimeout(timeoutId);
                if (this.db) {
                    this.db.close();
                }
                reject(new Error('Query cancelled by user'));
            });

            // Execute query with row limit
            const limitedQuery = this.addLimitToQuery(query, maxRows);
            
            this.db.all(limitedQuery, (err: Error | null, rows: QueryResult[]) => {
                clearTimeout(timeoutId);
                cancellationListener?.dispose();

                if (err) {
                    this.db.close();
                    reject(new Error(`Query failed: ${err.message}`));
                    return;
                }

                // Close database connection
                this.db.close((closeErr: Error | null) => {
                    if (closeErr) {
                        console.error('Error closing database:', closeErr);
                    }
                });

                resolve(rows || []);
            });
        });
    }

    private addLimitToQuery(query: string, maxRows: number): string {
        const trimmedQuery = query.trim();
        
        // Check if query already has a LIMIT clause
        const limitRegex = /\bLIMIT\s+\d+/i;
        if (limitRegex.test(trimmedQuery)) {
            return trimmedQuery; // Don't modify if already has LIMIT
        }

        // Add LIMIT to the end of the query
        return `${trimmedQuery} LIMIT ${maxRows}`;
    }

    async testConnection(): Promise<boolean> {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const databasePath = config.get<string>('databasePath', '');

        if (!databasePath || !fs.existsSync(databasePath)) {
            return false;
        }

        try {
            const testResults = await this.executeQuery('SELECT COUNT(*) as count FROM cursorDiskKV LIMIT 1');
            return testResults.length > 0;
        } catch (error) {
            return false;
        }
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

            // Get table names
            const tableResults = await this.executeQuery(`
                SELECT name FROM sqlite_master 
                WHERE type='table' 
                ORDER BY name
            `);
            const tables = tableResults.map(row => row.name);

            // Get record count from main table
            const countResults = await this.executeQuery('SELECT COUNT(*) as count FROM cursorDiskKV');
            const recordCount = countResults[0]?.count || 0;

            return { tables, size, recordCount };
        } catch (error) {
            throw new Error(`Failed to get database info: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getTableSchema(tableName: string): Promise<QueryResult[]> {
        try {
            return await this.executeQuery(`PRAGMA table_info(${tableName})`);
        } catch (error) {
            throw new Error(`Failed to get table schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getSampleData(tableName: string, limit: number = 5): Promise<QueryResult[]> {
        try {
            return await this.executeQuery(`SELECT * FROM ${tableName} LIMIT ${limit}`);
        } catch (error) {
            throw new Error(`Failed to get sample data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    dispose() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
