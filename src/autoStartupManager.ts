import * as vscode from 'vscode';

export class AutoStartupManager {
    private context: vscode.ExtensionContext;
    private readonly STATE_KEYS = {
        AUTO_STARTUP_ENABLED: 'autoStartup.enabled',
        IS_FIRST_INSTALL: 'autoStartup.isFirstInstall',
        LAST_SESSION_END: 'autoStartup.lastSessionEnd'
    };

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.initializeAutoStartup();
    }

    /**
     * Initialize auto-startup on first installation or extension activation
     */
    private initializeAutoStartup(): void {
        const isFirstInstall = this.context.globalState.get(this.STATE_KEYS.IS_FIRST_INSTALL, true);
        
        // ALWAYS enable auto-startup (user requirement: always start on VS Code open)
        this.context.globalState.update(this.STATE_KEYS.AUTO_STARTUP_ENABLED, true);
        
        if (isFirstInstall) {
            // First installation
            this.context.globalState.update(this.STATE_KEYS.IS_FIRST_INSTALL, false);
            console.log('✅ First-time installation: Auto-startup enabled, scheduler will ALWAYS start on VS Code open');
        } else {
            console.log('✅ Auto-startup confirmed enabled - scheduler will ALWAYS start on VS Code open');
        }
    }

    /**
     * Check if auto-startup is enabled
     */
    isAutoStartupEnabled(): boolean {
        return this.context.globalState.get(this.STATE_KEYS.AUTO_STARTUP_ENABLED, true);
    }

    /**
     * Simple auto-start check - ALWAYS return true (always start on VS Code open)
     */
    shouldAutoStart(): boolean {
        if (!this.isAutoStartupEnabled()) {
            return false;
        }

        console.log('🚀 VS Code/Cursor opened - will auto-start scheduler (always ON behavior)');
        return true;
    }

    /**
     * Record when VS Code/Cursor session ends (for detecting fresh startups)
     */
    recordSessionEnd(): void {
        this.context.globalState.update(this.STATE_KEYS.LAST_SESSION_END, Date.now());
        console.log('📝 Session end recorded');
    }

    /**
     * Always force start on VS Code/Cursor launch
     */
    shouldForceStartOnFreshLaunch(): boolean {
        console.log('🆕 VS Code/Cursor launch detected - forcing auto-start (no thresholds)');
        return true;
    }

    /**
     * Simplified status - no manual stop tracking or timeouts
     */
    getStatus(): {
        autoStartupEnabled: boolean;
        alwaysStartOnOpen: boolean;
    } {
        return {
            autoStartupEnabled: this.isAutoStartupEnabled(),
            alwaysStartOnOpen: true // Always start when VS Code/Cursor opens
        };
    }

    /**
     * Disable auto-startup (for advanced users who want manual control)
     */
    disableAutoStartup(): void {
        this.context.globalState.update(this.STATE_KEYS.AUTO_STARTUP_ENABLED, false);
        console.log('⚠️ Auto-startup disabled - scheduler will need manual control');
    }

    /**
     * Enable auto-startup
     */
    enableAutoStartup(): void {
        this.context.globalState.update(this.STATE_KEYS.AUTO_STARTUP_ENABLED, true);
        console.log('✅ Auto-startup enabled');
    }

    /**
     * Clean up resources - no timers to clean up in simplified version
     */
    dispose(): void {
        console.log('AutoStartupManager disposed');
    }
}