'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useRemoteController, type UseRemote } from './useRemote';

// One transport for the whole app. The necklace is a single-connection peripheral (see
// shared/PROTOCOL.md), so Editor and Remote must share ONE connection rather than each opening
// their own. RemoteProvider owns it; every screen reads it via useRemote().
const RemoteContext = createContext<UseRemote | null>(null);

export function RemoteProvider({ children }: { children: ReactNode }) {
  const remote = useRemoteController();
  return <RemoteContext.Provider value={remote}>{children}</RemoteContext.Provider>;
}

export function useRemote(): UseRemote {
  const ctx = useContext(RemoteContext);
  if (!ctx) {
    throw new Error('useRemote must be used within <RemoteProvider> (wrap the app in layout.tsx)');
  }
  return ctx;
}
