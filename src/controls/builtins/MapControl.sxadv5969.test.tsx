import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MapControl } from './MiscControls';
import { mapUrl } from '../mapUrl';
import { EXPECTED_CONTROL_TYPES } from '../expectedTypes';
import { registerBuiltinControls } from './index';
import { controls } from '../registry';

// SXADV-5969.2: il controllo `map` (GMapUIControl in CORE) e' un bottone con
// l'icona della mappa che apre Google Maps in una scheda nuova. Come il bottone
// ExtJS del legacy sta fuori dalla sequenza del TAB.
//
// Niente DOM nei test: il markup si legge col render lato server, il clic si
// prova chiamando il gestore dell'elemento che il componente restituisce.

type Props = Parameters<typeof MapControl>[0];

function props(control: Record<string, unknown>): Props {
  return { control: { id: 'mappa1', type: 'map', ...control }, onAction: vi.fn() } as unknown as Props;
}

function markup(control: Record<string, unknown>): string {
  return renderToStaticMarkup(<MapControl {...props(control)} />);
}

/** L'elemento Button che il componente restituisce (senza renderlo). */
function bottone(control: Record<string, unknown>): React.ReactElement<Record<string, unknown>> {
  return (MapControl as unknown as (p: Props) => React.ReactElement<Record<string, unknown>>)(props(control));
}

const CARPI = 'VIA DEI TRASPORTI 1\n41012 Carpi (MO)';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MapControl: registrazione', () => {
  it('il tipo `map` e\' fra i tipi attesi', () => {
    expect([...(EXPECTED_CONTROL_TYPES as Iterable<string>)]).toContain('map');
  });

  it('il tipo `map` e\' registrato su MapControl', () => {
    registerBuiltinControls();
    expect(controls.map).toBe(MapControl);
  });
});

describe('MapControl: resa', () => {
  it('invisibile: non rende niente', () => {
    expect(markup({ visible: false, address: CARPI })).toBe('');
  });

  it('bottone con l\'icona della mappa, titolo "Mostra mappa", fuori dal TAB', () => {
    const html = markup({ address: CARPI });
    expect(html).toMatch(/<button/);
    expect(html).toContain('src="/entrasp/images/icons/map.png"');
    expect(html).toContain('title="Mostra mappa"');
    expect(html).toMatch(/tabindex="-1"/i);
    expect(html).not.toMatch(/disabled=""/);
  });

  it.each([
    ['senza indirizzo', {}],
    ['indirizzo vuoto', { address: '' }],
    ['indirizzo di soli spazi', { address: '   ' }],
  ])('%s: disabilitato', (_nome, control) => {
    expect(markup(control)).toMatch(/<button[^>]*disabled=""/);
  });
});

describe('MapControl: clic', () => {
  it('apre la mappa dell\'indirizzo in una scheda nuova', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const el = bottone({ address: CARPI });
    (el.props.onClick as () => void)();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(mapUrl(CARPI));
    expect(open.mock.calls[0][1]).toBe('_blank');
  });

  it('con un\'origine diversa apre il percorso', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const el = bottone({ address: CARPI, pathFrom: 'Piazza Grande, Modena' });
    (el.props.onClick as () => void)();
    expect(open.mock.calls[0][0]).toBe(mapUrl(CARPI, 'Piazza Grande, Modena'));
    expect(String(open.mock.calls[0][0])).toContain('/maps/dir/');
    expect(open.mock.calls[0][1]).toBe('_blank');
  });

  it('senza indirizzo il clic non apre niente', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const el = bottone({ address: '' });
    expect(el.props.disabled).toBe(true);
    (el.props.onClick as (() => void) | undefined)?.();
    expect(open).not.toHaveBeenCalled();
  });
});
