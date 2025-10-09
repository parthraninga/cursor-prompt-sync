import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ResultsViewer {
    private context: vscode.ExtensionContext;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('Cursor SQL Results');
    }

    async showResults(): Promise<void> {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const outputDir = config.get<string>('outputDirectory', './cursor-query-results');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const fullPath = path.join(workspaceRoot, outputDir);

        if (!fs.existsSync(fullPath)) {
            vscode.window.showWarningMessage('No query results directory found. Run a query first.');
            return;
        }

        // Get all result files
        const files = fs.readdirSync(fullPath)
            .filter(file => file.endsWith('.json') || file.endsWith('.csv') || file.endsWith('.html') || file.endsWith('.txt'))
            .map(file => {
                const filePath = path.join(fullPath, file);
                const stats = fs.statSync(filePath);
                return {
                    name: file,
                    path: filePath,
                    modified: stats.mtime,
                    size: stats.size
                };
            })
            .sort((a, b) => b.modified.getTime() - a.modified.getTime());

        if (files.length === 0) {
            vscode.window.showInformationMessage('No query result files found. Run a query first.');
            return;
        }

        // Show file picker
        const options = files.map(file => ({
            label: file.name,
            description: `${this.formatFileSize(file.size)} - ${file.modified.toLocaleString()}`,
            detail: file.path,
            file: file
        }));

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select a result file to view',
            matchOnDescription: true
        });

        if (!selection) {
            return;
        }

        // Open the selected file
        await this.openResultFile(selection.file);
    }

    private async openResultFile(file: { name: string, path: string, modified: Date, size: number }): Promise<void> {
        const extension = path.extname(file.name).toLowerCase();

        try {
            if (extension === '.html') {
                // Open HTML files in a webview
                await this.showHTMLResults(file);
            } else {
                // Open other files in text editor
                const document = await vscode.workspace.openTextDocument(file.path);
                await vscode.window.showTextDocument(document);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open result file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async showHTMLResults(file: { name: string, path: string, modified: Date, size: number }): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'cursorSqlResults',
            `Query Results - ${path.basename(file.name, '.html')}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Read and display HTML content
        const htmlContent = fs.readFileSync(file.path, 'utf8');
        panel.webview.html = htmlContent;

        // Add refresh capability
        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'refresh':
                        const updatedContent = fs.readFileSync(file.path, 'utf8');
                        panel.webview.html = updatedContent;
                        return;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    async showResultsInOutput(results: any[], query: string): Promise<void> {
        this.outputChannel.clear();
        this.outputChannel.appendLine('====================================================');
        this.outputChannel.appendLine('CURSOR SQL QUERY RESULTS');
        this.outputChannel.appendLine('====================================================');
        this.outputChannel.appendLine(`Timestamp: ${new Date().toISOString()}`);
        this.outputChannel.appendLine(`Results: ${results.length} rows`);
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('Query:');
        this.outputChannel.appendLine('----------------------------------------------------');
        this.outputChannel.appendLine(query);
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('Results:');
        this.outputChannel.appendLine('----------------------------------------------------');

        if (results.length === 0) {
            this.outputChannel.appendLine('No results found.');
        } else {
            // Format as table for better readability
            this.formatResultsAsTable(results);
        }

        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('====================================================');
        this.outputChannel.show();
    }

    private formatResultsAsTable(results: any[]): void {
        if (results.length === 0) return;

        const headers = Object.keys(results[0]);
        const columnWidths: number[] = [];

        // Calculate column widths
        headers.forEach((header, index) => {
            let maxWidth = header.length;
            results.forEach(row => {
                const value = String(row[header] || '');
                if (value.length > maxWidth) {
                    maxWidth = value.length;
                }
            });
            columnWidths[index] = Math.min(maxWidth, 50); // Cap at 50 characters
        });

        // Format header row
        let headerRow = '| ';
        headers.forEach((header, index) => {
            headerRow += header.padEnd(columnWidths[index]) + ' | ';
        });
        this.outputChannel.appendLine(headerRow);

        // Format separator row
        let separatorRow = '|';
        columnWidths.forEach(width => {
            separatorRow += '-'.repeat(width + 2) + '|';
        });
        this.outputChannel.appendLine(separatorRow);

        // Format data rows (limit to first 100 rows for performance)
        const displayResults = results.slice(0, 100);
        displayResults.forEach(row => {
            let dataRow = '| ';
            headers.forEach((header, index) => {
                let value = String(row[header] || '');
                if (value.length > columnWidths[index]) {
                    value = value.substring(0, columnWidths[index] - 3) + '...';
                }
                dataRow += value.padEnd(columnWidths[index]) + ' | ';
            });
            this.outputChannel.appendLine(dataRow);
        });

        if (results.length > 100) {
            this.outputChannel.appendLine(`... and ${results.length - 100} more rows (showing first 100)`);
        }
    }

    async exportCurrentResults(results: any[], format: 'json' | 'csv' | 'html' | 'txt' = 'json'): Promise<void> {
        const config = vscode.workspace.getConfiguration('cursorSqlRunner');
        const outputDir = config.get<string>('outputDirectory', './cursor-query-results');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `manual_export_${timestamp}.${format}`;
        const fullPath = path.join(workspaceRoot, outputDir, fileName);

        // Ensure directory exists
        const dirPath = path.dirname(fullPath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        try {
            switch (format) {
                case 'json':
                    fs.writeFileSync(fullPath, JSON.stringify({
                        timestamp: new Date().toISOString(),
                        resultCount: results.length,
                        results: results
                    }, null, 2), 'utf8');
                    break;
                case 'csv':
                    this.saveAsCSV(fullPath, results);
                    break;
                case 'html':
                    this.saveAsHTML(fullPath, results);
                    break;
                case 'txt':
                    this.saveAsText(fullPath, results);
                    break;
            }

            vscode.window.showInformationMessage(
                `Results exported to ${fileName}`,
                'Open File'
            ).then(choice => {
                if (choice === 'Open File') {
                    vscode.workspace.openTextDocument(fullPath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private saveAsCSV(filePath: string, results: any[]): void {
        if (results.length === 0) return;

        const headers = Object.keys(results[0]);
        let csvContent = headers.join(',') + '\n';
        
        results.forEach(row => {
            const values = headers.map(header => {
                const value = row[header];
                const str = value !== null && value !== undefined ? String(value) : '';
                return str.includes(',') || str.includes('"') || str.includes('\n') ? 
                    `"${str.replace(/"/g, '""')}"` : str;
            });
            csvContent += values.join(',') + '\n';
        });

        fs.writeFileSync(filePath, csvContent, 'utf8');
    }

    private saveAsHTML(filePath: string, results: any[]): void {
        let htmlContent = `<!DOCTYPE html>
<html>
<head>
    <title>Cursor SQL Results</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        tr:nth-child(even) { background-color: #f9f9f9; }
    </style>
</head>
<body>
    <h1>Query Results</h1>
    <p>Generated: ${new Date().toISOString()}</p>
    <p>Results: ${results.length} rows</p>`;

        if (results.length > 0) {
            const headers = Object.keys(results[0]);
            htmlContent += '<table><thead><tr>';
            headers.forEach(header => {
                htmlContent += `<th>${this.escapeHtml(header)}</th>`;
            });
            htmlContent += '</tr></thead><tbody>';

            results.forEach(row => {
                htmlContent += '<tr>';
                headers.forEach(header => {
                    const value = row[header];
                    const displayValue = value !== null && value !== undefined ? String(value) : '';
                    htmlContent += `<td>${this.escapeHtml(displayValue)}</td>`;
                });
                htmlContent += '</tr>';
            });

            htmlContent += '</tbody></table>';
        } else {
            htmlContent += '<p>No results found.</p>';
        }

        htmlContent += '</body></html>';
        fs.writeFileSync(filePath, htmlContent, 'utf8');
    }

    private saveAsText(filePath: string, results: any[]): void {
        let content = `Query Results\n${'='.repeat(50)}\n`;
        content += `Generated: ${new Date().toISOString()}\n`;
        content += `Results: ${results.length} rows\n\n`;

        if (results.length > 0) {
            const headers = Object.keys(results[0]);
            const columnWidths = headers.map(header => {
                const maxValueLength = Math.max(
                    ...results.map(row => String(row[header] || '').length)
                );
                return Math.max(header.length, maxValueLength, 10);
            });

            // Header
            let headerLine = '| ';
            headers.forEach((header, i) => {
                headerLine += header.padEnd(columnWidths[i]) + ' | ';
            });
            content += headerLine + '\n';

            // Separator
            let separatorLine = '|';
            columnWidths.forEach(width => {
                separatorLine += '-'.repeat(width + 2) + '|';
            });
            content += separatorLine + '\n';

            // Data
            results.forEach(row => {
                let dataLine = '| ';
                headers.forEach((header, i) => {
                    const value = row[header] !== null && row[header] !== undefined ? 
                        String(row[header]) : '';
                    dataLine += value.padEnd(columnWidths[i]) + ' | ';
                });
                content += dataLine + '\n';
            });
        } else {
            content += 'No results found.\n';
        }

        fs.writeFileSync(filePath, content, 'utf8');
    }

    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
