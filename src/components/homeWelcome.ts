import type { LoginInfo } from '../types/ui';

type WelcomeInfo = Pick<LoginInfo, 'login' | 'name'>;

// SXADV-5475: the Home greets the user by the "Nome" of their user record;
// a blank name (missing, null, CHAR padding) falls back to the login.
export function welcomeName(info: WelcomeInfo): string {
  const name = info.name?.trim();
  return name ? name : info.login;
}

export function welcomeText(info: WelcomeInfo): string {
  return `Benvenuta/o, ${welcomeName(info)}`;
}
