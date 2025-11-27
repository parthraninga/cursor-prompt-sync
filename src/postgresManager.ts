import { Pool, Client, QueryResult as PgQueryResult } from 'pg';
import * as vscode from 'vscode';
import { POSTGRES_DEFAULTS } from './postgresDefaults';
import { getUserIdSecret } from './secretStorage';

export interface QueryResult {
    id?: string;
    query: string;
    results: any[];
    timestamp: string;
    execution_time_ms: number;
    row_count: number;
    metadata?: any;
    user_id?: string;
    session_id?: string;
    query_type?: string;
}

export interface PostgresConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    tableName: string;
}

export class PostgresManager {
    private pool: Pool | null = null;
    private config: PostgresConfig | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Cursor SQL Runner - PostgreSQL');
    }

    /**
     * Check if PostgreSQL client is initialized
     */
    isInitialized(): boolean {
        return this.pool !== null && this.config !== null;
    }

    /**
     * Initialize PostgreSQL connection with configuration from VS Code settings
     */
    public async initialize(): Promise<boolean> {
        try {
            const { host, port, database, user, password, tableName } = POSTGRES_DEFAULTS;

            this.config = { host, port, database, user, password, tableName };
            
            // Create connection pool
            this.pool = new Pool({
                host: this.config.host,
                port: this.config.port,
                database: this.config.database,
                user: this.config.user,
                password: this.config.password,
                max: 10, // Maximum number of clients in the pool
                idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
                connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
            });

            // Test connection
            const client = await this.pool.connect();
            try {
                await client.query('SELECT 1');
                
                // Check if table exists, create if not
                await this.ensureTableExists();
                return true;
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Initialization error: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to initialize PostgreSQL: ${error.message}`);
            return false;
        }
    }

    /**
     * Ensure the table exists in PostgreSQL, create if it doesn't
     */
    private async ensureTableExists(): Promise<void> {
        if (!this.pool || !this.config) {
            throw new Error('PostgreSQL client not initialized');
        }

        const createTableSQL = `
        CREATE TABLE IF NOT EXISTS ${this.config.tableName} (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
            timestamp TEXT NOT NULL,
            prompt TEXT NOT NULL,
            user_id TEXT
        );

        -- Create indexes for better query performance
        CREATE INDEX IF NOT EXISTS idx_${this.config.tableName}_created_at ON ${this.config.tableName}(created_at);
        CREATE INDEX IF NOT EXISTS idx_${this.config.tableName}_user_id ON ${this.config.tableName}(user_id);
        `;

        try {
            const client = await this.pool.connect();
            try {
                await client.query(createTableSQL);
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Table creation error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Store query result to PostgreSQL
     */
    public async storeResult(queryResult: QueryResult): Promise<string | null> {
        if (!this.pool || !this.config) {
            throw new Error('PostgreSQL client not initialized. Please run "Setup PostgreSQL Connection" first.');
        }

        try {
            // Add user identification (could be enhanced with actual user info)
            if (!queryResult.user_id) {
                queryResult.user_id = 'local_user';
            }

            const client = await this.pool.connect();
            try {
                const insertQuery = `
                    INSERT INTO ${this.config.tableName} 
                    (timestamp, prompt, user_id)
                    VALUES ($1, $2, $3)
                    RETURNING id
                `;

                const values = [
                    queryResult.timestamp,
                    queryResult.query, // Using query as prompt
                    queryResult.user_id || 'local_user'
                ];

                const result = await client.query(insertQuery, values);
                const insertedId = result.rows[0]?.id;

                return insertedId.toString();
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Store result error: ${error.message}`);
            throw new Error(`Failed to store query result: ${error.message}`);
        }
    }

    /**
     * Retrieve stored query results from PostgreSQL
     */
    public async getResults(filters?: {
        limit?: number;
        offset?: number;
        startDate?: string;
        endDate?: string;
        userId?: string;
        sessionId?: string;
        queryType?: string;
    }): Promise<QueryResult[]> {
        if (!this.pool || !this.config) {
            throw new Error('PostgreSQL client not initialized');
        }

        try {
            let query = `SELECT * FROM ${this.config.tableName}`;
            const conditions: string[] = [];
            const values: any[] = [];
            let paramCount = 0;

            // Add filters
            if (filters?.startDate) {
                conditions.push(`timestamp >= $${++paramCount}`);
                values.push(filters.startDate);
            }

            if (filters?.endDate) {
                conditions.push(`timestamp <= $${++paramCount}`);
                values.push(filters.endDate);
            }

            if (filters?.userId) {
                conditions.push(`user_id = $${++paramCount}`);
                values.push(filters.userId);
            }

            if (filters?.sessionId) {
                conditions.push(`session_id = $${++paramCount}`);
                values.push(filters.sessionId);
            }

            if (filters?.queryType) {
                conditions.push(`query_type = $${++paramCount}`);
                values.push(filters.queryType);
            }

            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }

            query += ' ORDER BY timestamp DESC';

            if (filters?.limit) {
                query += ` LIMIT $${++paramCount}`;
                values.push(filters.limit);
            }

            if (filters?.offset) {
                query += ` OFFSET $${++paramCount}`;
                values.push(filters.offset);
            }

            const client = await this.pool.connect();
            try {
                const result = await client.query(query, values);
                return result.rows.map((row: any) => ({
                    id: row.id.toString(),
                    query: row.query || row.prompt, // Support both old and new schema
                    results: typeof row.results === 'string' ? JSON.parse(row.results) : (row.results || []),
                    timestamp: row.timestamp,
                    execution_time_ms: row.execution_time_ms || 0,
                    row_count: row.row_count || 0,
                    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
                    user_id: row.user_id,
                    session_id: row.session_id,
                    query_type: row.query_type
                }));
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Get results error: ${error.message}`);
            throw new Error(`Failed to retrieve query results: ${error.message}`);
        }
    }

    /**
     * Execute a raw SQL query against PostgreSQL
     */
    public async executeQuery(query: string): Promise<any[]> {
        if (!this.pool) {
            throw new Error('PostgreSQL client not initialized');
        }

        try {
            const client = await this.pool.connect();
            try {
                const result = await client.query(query);
                return result.rows;
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Execute query error: ${error.message}`);
            throw new Error(`Failed to execute query: ${error.message}`);
        }
    }

    /**
     * Get analytics/statistics from stored query results
     */
    public async getAnalytics(options?: {
        startDate?: string;
        endDate?: string;
        groupBy?: 'day' | 'week' | 'month';
    }): Promise<any> {
        if (!this.pool || !this.config) {
            throw new Error('PostgreSQL client not initialized');
        }

        try {
            const groupBy = options?.groupBy || 'day';
            let dateFormat: string;
            
            switch (groupBy) {
                case 'week':
                    dateFormat = "YYYY-IW";
                    break;
                case 'month':
                    dateFormat = "YYYY-MM";
                    break;
                default:
                    dateFormat = "YYYY-MM-DD";
            }

            let query = `
                SELECT 
                    TO_CHAR(created_at, '${dateFormat}') as period,
                    COUNT(*) as query_count,
                    AVG(execution_time_ms) as avg_execution_time,
                    AVG(row_count) as avg_row_count,
                    query_type,
                    COUNT(DISTINCT session_id) as unique_sessions
                FROM ${this.config.tableName}
            `;

            const conditions: string[] = [];
            const values: any[] = [];
            let paramCount = 0;

            if (options?.startDate) {
                conditions.push(`created_at >= $${++paramCount}`);
                values.push(options.startDate);
            }

            if (options?.endDate) {
                conditions.push(`created_at <= $${++paramCount}`);
                values.push(options.endDate);
            }

            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }

            query += ` GROUP BY period, query_type ORDER BY period DESC`;

            const client = await this.pool.connect();
            try {
                const result = await client.query(query, values);
                return result.rows;
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Get analytics error: ${error.message}`);
            throw new Error(`Failed to get analytics: ${error.message}`);
        }
    }

    /**
     * Delete old records based on age
     */
    public async cleanupOldRecords(daysToKeep: number = 30): Promise<number> {
        if (!this.pool || !this.config) {
            throw new Error('PostgreSQL client not initialized');
        }

        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const deleteQuery = `
                DELETE FROM ${this.config.tableName} 
                WHERE created_at < $1
            `;

            const client = await this.pool.connect();
            try {
                const result = await client.query(deleteQuery, [cutoffDate.toISOString()]);
                const deletedCount = result.rowCount || 0;
                return deletedCount;
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Cleanup error: ${error.message}`);
            throw new Error(`Failed to cleanup old records: ${error.message}`);
        }
    }

    /**
     * Test the PostgreSQL connection
     */
    public async testConnection(): Promise<boolean> {
        if (!this.pool) {
            return false;
        }

        try {
            const client = await this.pool.connect();
            try {
                await client.query('SELECT 1');
                return true;
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Connection test failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Close all database connections
     */
    public async dispose(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    /**
     * Get current configuration
     */
    public getConfig(): PostgresConfig | null {
        return this.config;
    }

    /**
     * Update configuration and reinitialize connection
     */
    public async updateConfig(newConfig: Partial<PostgresConfig>): Promise<boolean> {
        if (this.config) {
            this.config = { ...this.config, ...newConfig };
            await this.dispose();
            return await this.initialize();
        }
        return false;
    }

    /**
     * Get the last datapoint for a specific user or globally
     */
    public async getLastDatapoint(): Promise<any | null> {
        if (!this.pool || !this.config) {
            throw new Error('PostgreSQL client not initialized');
        }
        
        try {
            const userId = await getUserIdSecret();
            
            let query: string;
            let values: any[] = [];
            
            if (!userId) {
                // Order by timestamp DESC to get the most recent prompt timestamp
                query = `SELECT * FROM ${this.config.tableName} ORDER BY timestamp DESC LIMIT 1`;
            } else {
                // Order by timestamp DESC to get the most recent prompt timestamp for this user
                query = `SELECT * FROM ${this.config.tableName} WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 1`;
                values = [userId];
            }

            const client = await this.pool.connect();
            try {
                const result = await client.query(query, values);
                const datapoint = result.rows.length > 0 ? result.rows[0] : null;
                
                return datapoint;
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Error in getLastDatapoint: ${error.message}`);
            throw error;
        }
    }

    /**
     * Store simple prompts from JSON data
     */
    public async storeSimplePrompts(jsonData: any): Promise<number> {
        if (!this.pool || !this.config) {
            throw new Error('PostgreSQL client not initialized. Please run "Setup PostgreSQL Connection" first.');
        }

        try {
            this.outputChannel.appendLine('\n=== PARSING JSON AND STORING TO TIMESTAMP-PROMPT COLUMNS ===');
            this.outputChannel.appendLine(`Using table: ${this.config.tableName}`);
            // Parse the JSON structure to extract results array
            let resultsArray: any[] = [];
            
            if (Array.isArray(jsonData)) {
                resultsArray = jsonData;
            } else if (jsonData.results && Array.isArray(jsonData.results)) {
                resultsArray = jsonData.results;
            } else {
                throw new Error('Invalid JSON structure. Expected array of objects or object with results array.');
            }

            // Process each result item
            const recordsToInsert: Array<{timestamp: string, prompt: string}> = [];
            
            for (let i = 0; i < resultsArray.length; i++) {
                const item = resultsArray[i];
                let timestamp = null;
                let prompt = null;

                // Extract timestamp - check various possible field names
                if (item.timestamp) {
                    timestamp = item.timestamp;
                } else if (item.created_at) {
                    timestamp = item.created_at;
                } else if (item.time) {
                    timestamp = item.time;
                } else {
                    continue;
                }

                // Extract prompt - check various possible field names
                if (item.prompt) {
                    prompt = item.prompt;
                } else if (item.text) {
                    prompt = item.text;
                } else if (item.message) {
                    prompt = item.message;
                } else if (item.content) {
                    prompt = item.content;
                } else {
                    continue;
                }

                recordsToInsert.push({ timestamp, prompt });
            }

            if (recordsToInsert.length === 0) {
                return 0;
            }

            // Get user ID for records
            const userId = await getUserIdSecret() || 'local_user';

            // Insert records in batch
            const client = await this.pool.connect();
            try {
                let insertedCount = 0;
                
                for (const record of recordsToInsert) {
                    const insertQuery = `
                        INSERT INTO ${this.config.tableName} 
                        (timestamp, prompt, user_id)
                        VALUES ($1, $2, $3)
                    `;
                    
                    const values = [
                        record.timestamp,
                        record.prompt,
                        userId
                    ];

                    await client.query(insertQuery, values);
                    insertedCount++;
                }

                return insertedCount;
            } finally {
                client.release();
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`Error storing simple prompts: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clear PostgreSQL configuration and close connections (for debugging/reset)
     */
    async clearConfiguration(): Promise<void> {
        try {
            console.log('🗑️ Clearing PostgreSQL configuration...');
            
            // Close existing connections
            if (this.pool) {
                await this.pool.end();
                this.pool = null;
                console.log('✅ PostgreSQL connection pool closed');
            }
            
            // Clear configuration
            this.config = null;
            console.log('✅ PostgreSQL configuration cleared');
            
        } catch (error: any) {
            console.log(`⚠️ Error clearing PostgreSQL configuration: ${error.message}`);
            // Don't throw - we want to continue the reset process
        }
    }

}