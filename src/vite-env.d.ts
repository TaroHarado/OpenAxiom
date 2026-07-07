/// <reference types="vite/client" />

declare global {
  var chrome: {
    runtime: {
      sendMessage: (message: unknown, callback: (response: unknown) => void) => void;
    };
    storage?: {
      local?: {
        get: (key: string | string[]) => Promise<Record<string, unknown>>;
        set: (items: Record<string, unknown>) => Promise<void>;
        remove: (key: string | string[]) => Promise<void>;
      };
      session?: {
        get: (key: string | string[]) => Promise<Record<string, unknown>>;
        set: (items: Record<string, unknown>) => Promise<void>;
        remove: (key: string | string[]) => Promise<void>;
      };
    };
  };
}

export {};
