import type { HostAPI } from './hostApi';

/** Dynamically load the control plugin bundle at `url` and hand it the host
 *  API. The plugin's default export must have the signature
 *  `(host: HostAPI) => void`. `/* @vite-ignore *\/` prevents Vite from trying
 *  to resolve the URL at build time — the bundle is shipped separately by
 *  the server application (not by the entrasp-ui build). */
export async function loadControlPlugin(url: string, host: HostAPI): Promise<void> {
  try {
    const mod = (await import(/* @vite-ignore */ url)) as {
      default?: (host: HostAPI) => void;
      register?: (host: HostAPI) => void;
    };
    const register = mod.default || mod.register;
    if (typeof register !== 'function') {
      console.error(`[controls] plugin at "${url}" has no default export or register() function`);
      return;
    }
    register(host);
  } catch (err) {
    console.error(`[controls] failed to load plugin from "${url}":`, err);
  }
}
