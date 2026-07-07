/// <reference types="vite/client" />

declare global {
  var chrome: {
    storage?: {
      local?: {
        get: (key: string) => Promise<Record<string, unknown>>;
        set: (items: Record<string, unknown>) => Promise<void>;
      };
    };
  };
}

export {};
