import * as vscode from 'vscode';

let extensionContext: vscode.ExtensionContext | null = null;

const DATABASE_PATH_SECRET = 'cursorSqlRunner.databasePath';
const USER_ID_SECRET = 'cursorSqlRunner.userId';

function requireContext(): vscode.ExtensionContext {
    if (!extensionContext) {
        throw new Error('Secret storage not initialized');
    }
    return extensionContext;
}

export function initializeSecretStorage(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

export async function getDatabasePathSecret(): Promise<string | undefined> {
    const context = requireContext();
    const existing = await context.secrets.get(DATABASE_PATH_SECRET);
    if (existing) {
        return existing;
    }

    // Legacy migration from settings.json
    const config = vscode.workspace.getConfiguration('cursorSqlRunner');
    const legacyValue = config.get<string>('databasePath', '');
    if (legacyValue) {
        await setDatabasePathSecret(legacyValue);
        await config.update('databasePath', undefined, vscode.ConfigurationTarget.Global);
        return legacyValue;
    }

    return undefined;
}

export async function setDatabasePathSecret(value: string): Promise<void> {
    const context = requireContext();
    await context.secrets.store(DATABASE_PATH_SECRET, value);
}

export async function getUserIdSecret(): Promise<string | undefined> {
    const context = requireContext();
    const existing = await context.secrets.get(USER_ID_SECRET);
    if (existing) {
        return existing;
    }

    const config = vscode.workspace.getConfiguration('cursorSqlRunner');
    const legacyValue = config.get<string>('userId', '');
    if (legacyValue) {
        await setUserIdSecret(legacyValue);
        await config.update('userId', undefined, vscode.ConfigurationTarget.Global);
        return legacyValue;
    }

    return undefined;
}

export async function setUserIdSecret(value: string): Promise<void> {
    const context = requireContext();
    await context.secrets.store(USER_ID_SECRET, value);
}



