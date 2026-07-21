import type {IpcChannels} from '../../electron/ipc/channels.ts';

export interface WindowControls {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  platform: () => Promise<string>;
  onMaximizedChange: (callback: (isMaximized: boolean) => void) => (() => void);
}

declare global {
  interface Window {
    electron: {
      invoke: <T extends keyof IpcChannels>(
        channel: T,
        ...args: Parameters<IpcChannels[T]>
      ) => Promise<ReturnType<IpcChannels[T]>>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
      windowControls: WindowControls;
    };
  }
}

export {};
