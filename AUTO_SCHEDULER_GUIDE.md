# 🕐 Auto-Scheduler Implementation - Version 1.4.0

## ✅ **CRON JOB FUNCTIONALITY IMPLEMENTED!**

Your extension now has a powerful auto-scheduler that runs your chosen SQL file automatically at configurable intervals and stores the simplified results to Supabase!

## 🚀 **What's New:**

### **AutoScheduler Class Features:**
- ✅ **File Selection**: Choose any SQL file to run automatically
- ✅ **Configurable Intervals**: 15min, 30min, 1hr, 2hr, 6hr, 12hr, 24hr, or custom
- ✅ **Background Execution**: Runs in the background without blocking VS Code
- ✅ **Status Bar Integration**: Shows current status and next execution time
- ✅ **Error Handling**: Tracks errors and provides notifications
- ✅ **State Persistence**: Remembers settings across VS Code restarts
- ✅ **Detailed Logging**: Full execution logs in output channel

## 🎯 **How to Use:**

### **Quick Setup:**
1. **Open Command Palette** (Ctrl+Shift+P)
2. **Run**: "Select SQL File for Auto-Scheduler"
3. **Choose your SQL file** (e.g., `final.sql`)
4. **Set interval** (default: 1 hour)
5. **Start scheduler**

### **Keyboard Shortcuts:**
- **Ctrl+Shift+A**: Toggle Auto-Scheduler on/off
- **Ctrl+Shift+T**: Show Auto-Scheduler status

### **Available Commands:**
```
📋 Auto-Scheduler Commands:
├── Select SQL File for Auto-Scheduler
├── Configure Auto-Scheduler Interval  
├── Start Auto-Scheduler
├── Stop Auto-Scheduler
├── Toggle Auto-Scheduler (Ctrl+Shift+A)
└── Show Auto-Scheduler Status (Ctrl+Shift+T)
```

## 📊 **Status Bar Integration:**

**When Running:**
```
$(clock) Auto-SQL [60m] Next: 3:45 PM
```

**When Stopped:**
```
$(clock) Auto-SQL [Stopped]
```

Click the status bar item to toggle on/off!

## ⚡ **What Happens Every Hour:**

1. **Execute SQL File** → Your chosen `.sql` file runs automatically
2. **Parse Results** → Extracts timestamp-prompt pairs from results
3. **Save Local File** → Saves to `auto_scheduled_TIMESTAMP.json`
4. **Store to Supabase** → Individual records with `id`, `timestamp`, `prompt`
5. **Log Everything** → Detailed logs in "Cursor Auto-Scheduler" output channel

## 🛠️ **Configuration Options:**

### **Interval Presets:**
- ⏱️ 15 minutes (for testing)
- ⏱️ 30 minutes  
- ⏱️ **1 hour (recommended)**
- ⏱️ 2 hours
- ⏱️ 6 hours
- ⏱️ 12 hours
- ⏱️ 24 hours
- 🛠️ Custom (minimum 5 minutes)

### **Settings (package.json):**
```json
{
  "cursorSqlRunner.autoSchedulerFile": "/path/to/your/final.sql",
  "cursorSqlRunner.autoSchedulerInterval": 60,
  "cursorSqlRunner.autoSchedulerEnabled": false
}
```

## 📈 **Status Tracking:**

```
🕐 Auto-Scheduler Status

Status: 🟢 Running
SQL File: final.sql
Interval: 60 minutes
Executions: 24
Errors: 0
Last Run: 2025-09-12 2:45:15 PM
Next Run: 2025-09-12 3:45:15 PM
```

## 🔧 **Behind the Scenes:**

### **File Naming:**
```
auto_scheduled_2025-09-12T14-45-15.json
```

### **Supabase Storage:**
```sql
INSERT INTO your_table (timestamp, prompt) VALUES 
('2025-09-12 14:45:15+00', 'User prompt 1'),
('2025-09-12 14:30:10+00', 'User prompt 2'),
('2025-09-12 14:15:05+00', 'User prompt 3');
```

### **Error Handling:**
- Database connection issues → Logged + notification
- SQL file missing → Auto-retry with error count
- Supabase errors → Detailed logging + option to stop

## 🎉 **Perfect for:**

- ✅ **Hourly data collection** from Cursor database
- ✅ **Automated backup** of prompts to cloud
- ✅ **Continuous monitoring** of Cursor usage
- ✅ **Data analytics** with regular updates
- ✅ **Background sync** without manual intervention

## 💡 **Usage Examples:**

### **Scenario 1: Hourly Prompt Collection**
```
1. Select your prompt extraction SQL file
2. Set interval to 60 minutes  
3. Start scheduler
4. Get fresh prompt data every hour in Supabase!
```

### **Scenario 2: Testing Setup**
```
1. Select a simple SQL file
2. Set interval to 15 minutes (for testing)
3. Start scheduler  
4. Watch logs to verify everything works
5. Switch to 60 minutes for production
```

## 🔥 **You Now Have:**

✅ **Automated cron job** functionality in VS Code
✅ **Configurable scheduling** (15min to 24hr intervals)  
✅ **Background execution** with full error handling
✅ **Status monitoring** via status bar + commands
✅ **Cloud storage** of parsed timestamp-prompt data
✅ **Persistent state** across VS Code sessions

**Your SQL file will now run automatically every hour and store clean data to Supabase! 🚀**
