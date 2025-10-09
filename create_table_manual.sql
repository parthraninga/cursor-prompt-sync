-- PostgreSQL Table Creation Script for Cursor Analytics
-- Run this script in pgAdmin4 or psql to manually create the table
-- Updated to simplified schema with only 5 columns as requested

-- Replace 'your_table_name' with your actual table name
-- e.g., 'cursor_query_results' or whatever you specified in the extension setup

CREATE TABLE IF NOT EXISTS your_table_name (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()),
  timestamp TEXT NOT NULL,
  prompt TEXT NOT NULL,
  user_id TEXT NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_your_table_name_created_at ON your_table_name(created_at);
CREATE INDEX IF NOT EXISTS idx_your_table_name_timestamp ON your_table_name(timestamp);
CREATE INDEX IF NOT EXISTS idx_your_table_name_user_id ON your_table_name(user_id);

-- Example insert to test the table
INSERT INTO your_table_name (timestamp, prompt, user_id) 
VALUES 
    ('2024-01-01T10:30:00Z', 'Sample prompt for testing', 'test_user'),
    ('2024-01-01T10:31:00Z', 'Another test prompt', 'test_user');

-- Query to check the data
SELECT * FROM your_table_name ORDER BY created_at DESC;

-- Verify table creation
SELECT table_name, column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'your_table_name' 
ORDER BY ordinal_position;

-- Example insert to test the table
INSERT INTO your_table_name (timestamp, prompt, user_id) 
VALUES ('2025-10-09T10:00:00Z', 'Test prompt', 'test_user');

-- Check if the insert worked
SELECT * FROM your_table_name LIMIT 5;