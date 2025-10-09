export interface QueryTemplate {
    name: string;
    description: string;
    query: string;
    category: string;
}

export class QueryTemplates {
    private templates: QueryTemplate[] = [
        // Daily Activity Queries
        {
            name: "Daily User Prompts",
            description: "Get all user prompts from yesterday",
            category: "Daily Activity",
            query: `SELECT 
    json_extract(value, '$.text') as user_prompt,
    datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime') as timestamp,
    json_extract(value, '$.bubbleId') as bubble_id
FROM cursorDiskKV 
WHERE key LIKE 'bubbleId:%' 
    AND json_extract(value, '$.type') = 1
    AND json_extract(value, '$.text') IS NOT NULL
    AND DATE(datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) = DATE('now', '-1 day')
ORDER BY timestamp DESC
LIMIT 100;`
        },
        {
            name: "AI Responses Count",
            description: "Count AI responses by day",
            category: "Daily Activity",
            query: `SELECT 
    DATE(datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) as date,
    COUNT(*) as ai_responses
FROM cursorDiskKV 
WHERE key LIKE 'bubbleId:%' 
    AND json_extract(value, '$.type') = 2
    AND json_extract(value, '$.timingInfo.clientRpcSendTime') IS NOT NULL
GROUP BY date
ORDER BY date DESC
LIMIT 30;`
        },

        // Composer Analysis
        {
            name: "Active Composer Sessions",
            description: "List all composer sessions with conversation counts",
            category: "Composer Analysis",
            query: `SELECT 
    json_extract(value, '$.name') as session_name,
    json_extract(value, '$.composerId') as composer_id,
    datetime(json_extract(value, '$.createdAt')/1000, 'unixepoch', 'localtime') as created_at,
    json_extract(value, '$.status') as status,
    json_array_length(json_extract(value, '$.fullConversationHeadersOnly')) as conversation_length
FROM cursorDiskKV 
WHERE key LIKE 'composerData:%'
    AND json_extract(value, '$.createdAt') IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;`
        },
        {
            name: "Composer Sessions by Date",
            description: "Count composer sessions created by date",
            category: "Composer Analysis", 
            query: `SELECT 
    DATE(datetime(json_extract(value, '$.createdAt')/1000, 'unixepoch', 'localtime')) as date,
    COUNT(*) as sessions_created,
    AVG(json_array_length(json_extract(value, '$.fullConversationHeadersOnly'))) as avg_conversation_length
FROM cursorDiskKV 
WHERE key LIKE 'composerData:%'
    AND json_extract(value, '$.createdAt') IS NOT NULL
GROUP BY date
ORDER BY date DESC
LIMIT 30;`
        },

        // Code Changes Analysis
        {
            name: "Code Diff Statistics",
            description: "Analyze code changes and diff sizes",
            category: "Code Changes",
            query: `SELECT 
    'codeBlockDiff' as diff_type,
    COUNT(*) as total_diffs,
    AVG(LENGTH(value)) as avg_size_bytes,
    MIN(LENGTH(value)) as min_size_bytes,
    MAX(LENGTH(value)) as max_size_bytes,
    SUM(LENGTH(value)) as total_size_bytes
FROM cursorDiskKV 
WHERE key LIKE 'codeBlockDiff:%'
UNION ALL
SELECT 
    'inlineDiff' as diff_type,
    COUNT(*) as total_diffs,
    AVG(LENGTH(value)) as avg_size_bytes,
    MIN(LENGTH(value)) as min_size_bytes,
    MAX(LENGTH(value)) as max_size_bytes,
    SUM(LENGTH(value)) as total_size_bytes
FROM cursorDiskKV 
WHERE key LIKE 'inlineDiff:%';`
        },
        {
            name: "Largest Code Changes",
            description: "Find the largest code changes by size",
            category: "Code Changes",
            query: `SELECT 
    key,
    LENGTH(value) as size_bytes,
    CASE 
        WHEN key LIKE 'codeBlockDiff:%' THEN 'Code Block Diff'
        WHEN key LIKE 'inlineDiff:%' THEN 'Inline Diff'
        ELSE 'Other'
    END as change_type
FROM cursorDiskKV 
WHERE (key LIKE 'codeBlockDiff:%' OR key LIKE 'inlineDiff:%')
ORDER BY LENGTH(value) DESC
LIMIT 20;`
        },

        // Database Analysis
        {
            name: "Database Overview",
            description: "Get overview of all data types in database",
            category: "Database Analysis",
            query: `SELECT 
    CASE 
        WHEN key LIKE 'bubbleId:%' THEN 'Bubble (Chat Messages)'
        WHEN key LIKE 'composerData:%' THEN 'Composer Sessions'
        WHEN key LIKE 'checkpointId:%' THEN 'File Checkpoints'
        WHEN key LIKE 'codeBlockDiff:%' THEN 'Code Block Diffs'
        WHEN key LIKE 'inlineDiff:%' THEN 'Inline Diffs'
        WHEN key LIKE 'messageRequestContext:%' THEN 'Message Context'
        ELSE 'Other'
    END as data_type,
    COUNT(*) as record_count,
    AVG(LENGTH(value)) as avg_size_bytes,
    SUM(LENGTH(value)) as total_size_bytes
FROM cursorDiskKV
GROUP BY data_type
ORDER BY record_count DESC;`
        },
        {
            name: "Largest Database Entries",
            description: "Find the largest entries in the database",
            category: "Database Analysis",
            query: `SELECT 
    key,
    LENGTH(value) as size_bytes,
    ROUND(LENGTH(value) / 1024.0, 2) as size_kb,
    CASE 
        WHEN key LIKE 'bubbleId:%' THEN 'Bubble'
        WHEN key LIKE 'composerData:%' THEN 'Composer'
        WHEN key LIKE 'checkpointId:%' THEN 'Checkpoint'
        ELSE 'Other'
    END as type
FROM cursorDiskKV
ORDER BY LENGTH(value) DESC
LIMIT 25;`
        },

        // Time-based Analysis
        {
            name: "Activity by Hour",
            description: "Analyze activity patterns by hour of day",
            category: "Time Analysis",
            query: `SELECT 
    strftime('%H', datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) as hour,
    COUNT(*) as activity_count,
    COUNT(CASE WHEN json_extract(value, '$.type') = 1 THEN 1 END) as user_prompts,
    COUNT(CASE WHEN json_extract(value, '$.type') = 2 THEN 1 END) as ai_responses
FROM cursorDiskKV 
WHERE key LIKE 'bubbleId:%' 
    AND json_extract(value, '$.timingInfo.clientRpcSendTime') IS NOT NULL
GROUP BY hour
ORDER BY hour;`
        },
        {
            name: "Weekly Activity Trend",
            description: "Show activity trends over the past weeks",
            category: "Time Analysis",
            query: `SELECT 
    DATE(datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) as date,
    strftime('%w', datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) as day_of_week,
    CASE strftime('%w', datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime'))
        WHEN '0' THEN 'Sunday'
        WHEN '1' THEN 'Monday'
        WHEN '2' THEN 'Tuesday'
        WHEN '3' THEN 'Wednesday'
        WHEN '4' THEN 'Thursday'
        WHEN '5' THEN 'Friday'
        WHEN '6' THEN 'Saturday'
    END as day_name,
    COUNT(*) as total_interactions
FROM cursorDiskKV 
WHERE key LIKE 'bubbleId:%' 
    AND json_extract(value, '$.timingInfo.clientRpcSendTime') IS NOT NULL
    AND DATE(datetime(json_extract(value, '$.timingInfo.clientRpcSendTime')/1000, 'unixepoch', 'localtime')) >= DATE('now', '-14 days')
GROUP BY date, day_of_week
ORDER BY date DESC;`
        },

        // Advanced Queries
        {
            name: "Session Correlation Analysis",
            description: "Correlate bubbles with their composer sessions",
            category: "Advanced Analysis",
            query: `SELECT 
    c.composer_id,
    c.session_name,
    c.created_at as session_created,
    COUNT(b.bubble_id) as total_bubbles,
    COUNT(CASE WHEN b.bubble_type = 1 THEN 1 END) as user_messages,
    COUNT(CASE WHEN b.bubble_type = 2 THEN 1 END) as ai_responses
FROM (
    SELECT 
        json_extract(value, '$.composerId') as composer_id,
        json_extract(value, '$.name') as session_name,
        datetime(json_extract(value, '$.createdAt')/1000, 'unixepoch', 'localtime') as created_at
    FROM cursorDiskKV 
    WHERE key LIKE 'composerData:%'
        AND json_extract(value, '$.composerId') IS NOT NULL
) c
LEFT JOIN (
    SELECT 
        json_extract(value, '$.composerId') as composer_id,
        json_extract(value, '$.bubbleId') as bubble_id,
        json_extract(value, '$.type') as bubble_type
    FROM cursorDiskKV 
    WHERE key LIKE 'bubbleId:%'
        AND json_extract(value, '$.composerId') IS NOT NULL
) b ON c.composer_id = b.composer_id
GROUP BY c.composer_id, c.session_name, c.created_at
ORDER BY c.created_at DESC
LIMIT 25;`
        },
        {
            name: "Message Length Analysis",
            description: "Analyze the length of user prompts and AI responses",
            category: "Advanced Analysis",
            query: `SELECT 
    CASE json_extract(value, '$.type')
        WHEN 1 THEN 'User Prompt'
        WHEN 2 THEN 'AI Response'
        ELSE 'Other'
    END as message_type,
    COUNT(*) as message_count,
    AVG(LENGTH(json_extract(value, '$.text'))) as avg_length,
    MIN(LENGTH(json_extract(value, '$.text'))) as min_length,
    MAX(LENGTH(json_extract(value, '$.text'))) as max_length,
    SUM(LENGTH(json_extract(value, '$.text'))) as total_characters
FROM cursorDiskKV 
WHERE key LIKE 'bubbleId:%' 
    AND json_extract(value, '$.text') IS NOT NULL
    AND json_extract(value, '$.type') IN (1, 2)
GROUP BY json_extract(value, '$.type')
ORDER BY message_count DESC;`
        }
    ];

    getTemplates(): QueryTemplate[] {
        return this.templates;
    }

    getTemplatesByCategory(category: string): QueryTemplate[] {
        return this.templates.filter(template => template.category === category);
    }

    getCategories(): string[] {
        const categories = new Set(this.templates.map(template => template.category));
        return Array.from(categories).sort();
    }

    getTemplateByName(name: string): QueryTemplate | undefined {
        return this.templates.find(template => template.name === name);
    }

    addCustomTemplate(template: QueryTemplate): void {
        this.templates.push(template);
    }

    removeCustomTemplate(name: string): boolean {
        const index = this.templates.findIndex(template => template.name === name);
        if (index !== -1) {
            this.templates.splice(index, 1);
            return true;
        }
        return false;
    }
}
