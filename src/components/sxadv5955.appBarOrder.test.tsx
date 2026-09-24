import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prerender } from 'react-dom/static';
import type { LoginInfo } from '../types/ui';

// SXADV-5955 (collaudo, Elena): nella barra verticale scura a sinistra della
// Home, "Documentale" sta DOPO "Posta Elettronica", cosi' che "Schermo intero"
// salga subito sotto "Esci" (e sotto Cambio Password, quando c'e').
//
// La prova rende davvero la Shell (render lato server: niente DOM, niente
// effetti) e legge i tooltip dei pulsanti della app bar nell'ordine in cui
// stanno nel markup. Il tooltip di antd non entra nel markup finche' non si
// passa sopra col mouse, quindi Tooltip e' sostituito da un contenitore che
// ne espone il titolo come attributo: e' il testo che l'utente legge.

// La modalita' documentale e' uno stato interno della Shell (parte sempre da
// 'menu'): per renderla gia' in documentale si intercetta quel solo stato
// iniziale.
const mode = vi.hoisted(() => ({ startInCdms: false }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = ((init: unknown) =>
    actual.useState(mode.startInCdms && init === 'menu' ? 'cdms' : init)) as typeof actual.useState;
  return { ...actual, default: { ...actual, useState }, useState };
});

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  const Tooltip = ({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) =>
    React.createElement('span', { 'data-tooltip': typeof title === 'string' ? title : '' }, children);
  return { ...actual, Tooltip };
});

// Estranei alla barra: la card dei banner della Home usa DOMParser (assente
// fuori dal browser), l'albero del documentale e' caricato in differita.
vi.mock('./BannerCard', () => ({ default: () => null }));
vi.mock('./CdmsTree', () => ({ default: () => null }));

const { default: Shell } = await import('./Shell');

const fullLogin: LoginInfo = {
  login: '44AMM',
  profile: 'AMM',
  customerKey: '44',
  cdms: true,
  cdmsAdmin: true,
  wikiUrl: 'https://wiki.example/',
  emailSent: true,
  agendaList: true,
  avvisi: true,
  areaDocumenti: true,
  notifications: true,
  assistenza: true,
  banners: [{ text: 'banner' }],
};

/** Tooltip dei pulsanti della app bar, nell'ordine del markup. */
async function appBarTooltips(loginInfo: LoginInfo): Promise<string[]> {
  // prerender attende le parti in differita (Suspense) invece di fallire.
  const { prelude } = await prerender(
    <Shell menuItems={[]} loginInfo={loginInfo} onLogout={() => {}} onReloadMenu={() => {}} />,
  );
  const html = await new Response(prelude).text();
  const start = html.indexOf('class="app-bar"');
  expect(start, 'la app bar non e\' stata resa').toBeGreaterThanOrEqual(0);
  const end = html.indexOf('class="sidebar"', start);
  const bar = html.slice(start, end < 0 ? undefined : end);
  return [...bar.matchAll(/data-tooltip="([^"]*)"/g)].map((m) => m[1].replace(/&#x27;/g, "'"));
}

/** Etichette brevi: il tooltip di Schermo intero porta anche le scorciatoie. */
const short = (t: string) => (t.startsWith('Schermo intero') ? 'Schermo intero' : t);

beforeEach(() => {
  mode.startInCdms = false;
});

describe('SXADV-5955: ordine della app bar', () => {
  it('modalita\' menu, utente con tutto: Esci, Cambio Password, Schermo intero, Posta Elettronica, Documentale, poi il resto come prima', async () => {
    expect((await appBarTooltips(fullLogin)).map(short)).toEqual([
      'Esci',
      'Cambio Password',
      'Schermo intero',
      'Posta Elettronica',
      'Documentale',
      'Area Documenti',
      'Aiuto',
      'Avvisi',
      'Notifiche',
      'Banner Informativi',
      'Gestione Profili',
      'Comandi in esecuzione',
      'Connessioni attive',
      'Costruttore Espressioni',
    ]);
  });

  it('senza Cambio Password (SSO) Schermo intero sta subito sotto Esci', async () => {
    const t = (await appBarTooltips({ ...fullLogin, changePassword: false })).map(short);
    expect(t.slice(0, 4)).toEqual(['Esci', 'Schermo intero', 'Posta Elettronica', 'Documentale']);
  });

  it('senza Posta Elettronica Documentale segue direttamente Schermo intero', async () => {
    const t = (await appBarTooltips({ ...fullLogin, emailSent: false })).map(short);
    expect(t).not.toContain('Posta Elettronica');
    expect(t.slice(0, 5)).toEqual(['Esci', 'Cambio Password', 'Schermo intero', 'Documentale', 'Area Documenti']);
  });

  it('senza documentale (cdms falso) Documentale non compare e il resto non si sposta', async () => {
    const t = (await appBarTooltips({ ...fullLogin, cdms: false })).map(short);
    expect(t).not.toContain('Documentale');
    expect(t).not.toContain('Torna al menu');
    expect(t.slice(0, 5)).toEqual(['Esci', 'Cambio Password', 'Schermo intero', 'Posta Elettronica', 'Area Documenti']);
  });

  it('modalita\' documentale: Torna al menu segue Schermo intero e precede le funzioni del documentale', async () => {
    mode.startInCdms = true;
    expect((await appBarTooltips(fullLogin)).map(short)).toEqual([
      'Esci',
      'Cambio Password',
      'Schermo intero',
      'Torna al menu',
      'Gestione Profili',
      'Gestione Utenti',
      'Aggiungi Albero',
      'Cestino',
      'Aiuto',
    ]);
  });
});
