import * as vscode from 'vscode';

export class QueryEditor {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async openEditor(): Promise<void> {
        // Create a new untitled document with SQL language
        const document = await vscode.workspace.openTextDocument({
            content: this.getDefaultQuery(),
            language: 'sql'
        });

        // Show the document in the editor
        const editor = await vscode.window.showTextDocument(document);

        // Add some helpful comments at the top
        const position = new vscode.Position(0, 0);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, position, this.getQueryTemplate());

        await vscode.workspace.applyEdit(edit);

        // Show information message
        vscode.window.showInformationMessage(
            'SQL Query Editor opened. Use Ctrl+Shift+Q to ru and lan your query.',
            'Run Query',
            'Quick Templates',
            'Run SQL File'
        ).then(selection => {
            if (selection === 'Run Query') {
                vscode.commands.executeCommand('cursor-sql-runner.runQuery');
            } else if (selection === 'Quick Templates') {
                vscode.commands.executeCommand('cursor-sql-runner.quickQuery');
            } else if (selection === 'Run SQL File') {
                vscode.commands.executeCommand('cursor-sql-runner.runSqlFile');
            }
        });
    }

    private getDefaultQuery(): string {
        return `-- Cursor Database Query
-- Use Ctrl+Shift+Q to execute

SELECT key, LENGTH(value) as size_bytes
FROM cursorDiskKV 
ORDER BY size_bytes DESC 
LIMIT 10;`;
    }

    private getQueryTemplate(): string {
        return `-- ====================================================================
-- CURSOR SQL RUNNER - Query Editor
-- ====================================================================
-- 
-- AVAILABLE TABLES:
-- • cursorDiskKV - Main table containing all Cursor data
--
-- KEY PATTERNS:
-- • bubbleId:*           - Chat messages and responses
-- • composerData:*       - Composer sessions and conversations  
-- • checkpointId:*       - File state checkpoints
-- • codeBlockDiff:*      - Code changes and diffs
-- • messageRequestContext:* - Request processing context
-- • inlineDiff:*         - Inline code changes
--
-- USEFUL JSON FIELDS:
-- • json_extract(value, '$.text')        - Message text
-- • json_extract(value, '$.type')        - Message type (1=user, 2=AI)
-- • json_extract(value, '$.composerId')  - Session identifier
-- • json_extract(value, '$.createdAt')   - Creation timestamp
-- • json_extract(value, '$.bubbleId')    - Bubble identifier
--
-- KEYBOARD SHORTCUTS:
-- • Ctrl+Shift+Q - Run current query
-- • Ctrl+Shift+E - Open query editor
-- • Ctrl+Shift+F - Run SQL file
-- • Ctrl+Shift+R - View results
--
-- EXTERNAL SQL FILES:
-- Create .sql files with your queries and use Ctrl+Shift+F to run them
-- This is perfect for complex queries or sharing queries with others
--
-- TIP: Select text to run only part of your query
-- ====================================================================

`;
    }

    async createCustomQuery(): Promise<string | undefined> {
        const queryBuilder = new QueryBuilder();
        return await queryBuilder.buildQuery();
    }
}

class QueryBuilder {
    async buildQuery(): Promise<string | undefined> {
        // Step 1: Choose data type
        const dataType = await this.chooseDataType();
        if (!dataType) return undefined;

        // Step 2: Choose fields
        const fields = await this.chooseFields(dataType);
        if (!fields || fields.length === 0) return undefined;

        // Step 3: Choose filters
        const filters = await this.chooseFilters(dataType);

        // Step 4: Choose ordering
        const ordering = await this.chooseOrdering();

        // Step 5: Choose limit
        const limit = await this.chooseLimit();

        // Build the query
        return this.buildSQLQuery(dataType, fields, filters, ordering, limit);
    }

    private async chooseDataType(): Promise<string | undefined> {
        const options = [
            { label: 'Chat Messages (bubbleId)', value: 'bubbleId:%' },
            { label: 'Composer Sessions (composerData)', value: 'composerData:%' },
            { label: 'File Checkpoints (checkpointId)', value: 'checkpointId:%' },
            { label: 'Code Changes (codeBlockDiff)', value: 'codeBlockDiff:%' },
            { label: 'Message Context (messageRequestContext)', value: 'messageRequestContext:%' },
            { label: 'All Data Types', value: '%' }
        ];

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select data type to query'
        });

        return selection?.value;
    }

    private async chooseFields(dataType: string): Promise<string[] | undefined> {
        const commonFields = ['key', 'LENGTH(value) as size_bytes'];
        
        let specificFields: string[] = [];
        
        if (dataType.includes('bubbleId')) {
            specificFields = [
                "json_extract(value, '$.text') as message_text",
                "json_extract(value, '$.type') as message_type",
                "json_extract(value, '$.composerId') as composer_id",
                "json_extract(value, '$.bubbleId') as bubble_id",
                "datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime') as timestamp"
            ];
        } else if (dataType.includes('composerData')) {
            specificFields = [
                "json_extract(value, '$.name') as session_name",
                "json_extract(value, '$.composerId') as composer_id",
                "datetime(json_extract(value, '$.createdAt')/1000, 'unixepoch', 'localtime') as created_at",
                "json_extract(value, '$.status') as status",
                "json_array_length(json_extract(value, '$.fullConversationHeadersOnly')) as conversation_length"
            ];
        }

        const allFields = [...commonFields, ...specificFields];
        
        const selectedFields = await vscode.window.showQuickPick(
            allFields.map(field => ({ label: field, picked: commonFields.includes(field) })),
            {
                canPickMany: true,
                placeHolder: 'Select fields to include in query'
            }
        );

        return selectedFields?.map(field => field.label);
    }

    private async chooseFilters(dataType: string): Promise<string[]> {
        const filters: string[] = [];
        
        // Add more filter options based on data type
        if (dataType.includes('bubbleId')) {
            const typeFilter = await vscode.window.showQuickPick([
                { label: 'All messages', value: '' },
                { label: 'User messages only', value: "json_extract(value, '$.type') = 1" },
                { label: 'AI responses only', value: "json_extract(value, '$.type') = 2" }
            ], { placeHolder: 'Filter by message type' });
            
            if (typeFilter?.value) {
                filters.push(typeFilter.value);
            }

            const dateFilter = await vscode.window.showQuickPick([
                { label: 'All dates', value: '' },
                { label: 'Today only', value: "DATE(datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) = DATE('now')" },
                { label: 'Yesterday only', value: "DATE(datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) = DATE('now', '-1 day')" },
                { label: 'Last 7 days', value: "DATE(datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) >= DATE('now', '-7 days')" }
            ], { placeHolder: 'Filter by date range' });

            if (dateFilter?.value) {
                filters.push(dateFilter.value);
            }
        }

        return filters;
    }

    private async chooseOrdering(): Promise<string> {
        const options = [
            { label: 'No specific order', value: '' },
            { label: 'By size (largest first)', value: 'LENGTH(value) DESC' },
            { label: 'By size (smallest first)', value: 'LENGTH(value) ASC' },
            { label: 'By key alphabetically', value: 'key ASC' }
        ];

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: 'Choose result ordering'
        });

        return selection?.value || '';
    }

    private async chooseLimit(): Promise<number> {
        const limitStr = await vscode.window.showInputBox({
            prompt: 'Maximum number of results (empty for no limit)',
            placeHolder: '100',
            validateInput: (value) => {
                if (value && (isNaN(Number(value)) || Number(value) <= 0)) {
                    return 'Please enter a positive number';
                }
                return null;
            }
        });

        return limitStr ? parseInt(limitStr) : 100;
    }

    private buildSQLQuery(dataType: string, fields: string[], filters: string[], ordering: string, limit: number): string {
        let query = 'SELECT ';
        query += fields.join(',\n       ');
        query += '\nFROM cursorDiskKV';
        
        // Add WHERE clause
        const conditions = [`key LIKE '${dataType}'`];
        if (filters.length > 0) {
            conditions.push(...filters);
        }
        query += '\nWHERE ' + conditions.join('\n  AND ');

        // Add ORDER BY
        if (ordering) {
            query += '\nORDER BY ' + ordering;
        }

        // Add LIMIT
        if (limit > 0) {
            query += `\nLIMIT ${limit}`;
        }

        query += ';';

        return query;
    }
}
