import * as React from 'react';
import { HotkeyRegistryContext, useHotkeyRegistry } from './hotkeys';
import { UiModeStoreContext, useUiModeStore } from './uiMode';

/**
 * Provider unico: registro dei tasti + stato delle modalità UI.
 * Va montato sopra tutto ciò che può registrare una combo o leggere una
 * modalità. Il file contiene solo componenti (react-refresh): la logica sta in
 * `hotkeys.ts` e `uiMode.ts`.
 */

const HotkeyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const registry = useHotkeyRegistry();
  return <HotkeyRegistryContext.Provider value={registry}>{children}</HotkeyRegistryContext.Provider>;
};

const UiModeStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useUiModeStore();
  return <UiModeStoreContext.Provider value={value}>{children}</UiModeStoreContext.Provider>;
};

export const UiModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <HotkeyProvider>
    <UiModeStateProvider>{children}</UiModeStateProvider>
  </HotkeyProvider>
);
