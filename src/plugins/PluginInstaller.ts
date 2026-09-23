/**
 * Copyright (c) 2026 这是作者名字. All rights reserved.
 */
import { registerPlugin } from '@capacitor/core';

export interface PluginInstallerResult {
    success: boolean;
    manifestId: string;
    version: string;
}

export interface PluginInstaller {
    install(options: { sourcePath: string; pluginsDir: string }): Promise<PluginInstallerResult>;
}

export const pluginInstaller = registerPlugin<PluginInstaller>('PluginInstaller');
