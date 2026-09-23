import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

interface CdpPluginType {
  start(opts: { port?: number; abstractSocketOverride?: string }): Promise<{ raw: string }>;
  stop(): Promise<void>;
  getCdpUrl(): Promise<{ url: string }>;
  sendCommand(opts: { method: string; params?: string }): Promise<any>;
}
const Cdp = registerPlugin<CdpPluginType>('Cdp');

export interface CdpHandle {
  send<T = any>(method: string, params?: Record<string, any>): Promise<T>;
  close(): void;
}

class CdpBridgeHandle implements CdpHandle {
  private started = false;

  async send<T = any>(method: string, params: Record<string, any> = {}): Promise<T> {
    // 确保 CDP proxy 已启动
    if (!this.started) {
      await Cdp.start({ port: 9222 });
      this.started = true;
    }

    const result = await Cdp.sendCommand({
      method,
      params: JSON.stringify(params),
    });

    if (result.error) {
      throw result.error;
    }

    return result.result as T;
  }

  close() {
    if (this.started) {
      Cdp.stop().catch(() => {});
      this.started = false;
    }
  }
}

let sharedHandle: CdpBridgeHandle | null = null;

export function getCdpHandle(): CdpHandle {
  if (!sharedHandle) {
    sharedHandle = new CdpBridgeHandle();
  }
  return sharedHandle;
}

export async function startLocalCdp(opts?: { port?: number }): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Cdp.start({ port: opts?.port ?? 9222 });
  } else {
    throw new Error('CDP is only available on native platforms');
  }
}

export async function stopLocalCdp(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Cdp.stop();
    sharedHandle = null;
  }
}
