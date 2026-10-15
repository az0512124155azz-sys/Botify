import { requireNativeModule } from 'expo-modules-core';
type Subscription = { remove(): void };
export type NativeTdlib = {
  start(): Promise<{ database: string; files: string }>;
  send(request: string): void;
  close(): Promise<void>;
  addListener(event: 'onUpdate', listener: (event: { json: string }) => void): Subscription;
};
// Resolve only when connecting, so a missing native module produces a useful UI error.
export function nativeTdlib(): NativeTdlib { return requireNativeModule('BotHubTdlib'); }
