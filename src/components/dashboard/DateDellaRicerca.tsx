import React from 'react';
import { InputNumber, Select, Space, Typography } from 'antd';
import { MODI_DATA, valeOggi } from './dateMobili';
import type { CriterioData, SceltaData } from './dateMobili';

export type { CriterioData, SceltaData } from './dateMobili';

interface Props {
  criteri: CriterioData[];
  scelte: Record<string, SceltaData>;
  onChange: (chiave: string, scelta: SceltaData) => void;
  disabled?: boolean;
}

/**
 * «Le date della ricerca» (SXADV-6105): per ogni data della ricerca, se il widget la
 * tiene com'e' stata battuta o la sposta col calendario. La stessa sezione in
 * «Aggiungi alla dashboard» e in «Modifica widget».
 *
 * <p>Ogni voce dice, sotto, che cosa vuol dire adesso: «Il widget cerca sempre al
 * 16/10/2026» o «oggi vale 23/10/2026». Senza, «il giorno in cui si aggiorna» accanto a
 * «(16/10/2026)» si leggeva come una data ferma, ed era l'equivoco del ticket.
 */
const DateDellaRicerca: React.FC<Props> = ({ criteri, scelte, onChange, disabled }) => (
  <div className="dash-date-ricerca">
    <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
      Il widget rifa&apos; questa ricerca a ogni aggiornamento, e anche quando dal widget si
      apre la lista completa. Per ogni data scegli se resta quella della ricerca o se si
      sposta col calendario.
    </Typography.Text>
    {criteri.map((c) => {
      const scelta = scelte[c.chiave] || { modo: 'fissa', giorni: 30 };
      const modi = MODI_DATA.map((m) =>
        m.value === 'fissa' ? { ...m, label: `sempre il ${c.valore}` } : m
      );
      // Un modo che il server conosce e il client no comparirebbe come chiave nuda:
      // meglio mostrarlo per quello che e'.
      const opzioni = modi.some((m) => m.value === scelta.modo)
        ? modi
        : [...modi, { value: scelta.modo, label: `${scelta.modo} (non riconosciuto)` }];
      const oggi = valeOggi(c, scelta);
      return (
        <div key={c.chiave} style={{ marginBottom: 8 }}>
          {/* Il valore battuto sta accanto all'etichetta: su certe maschere le etichette
              sono «Data / da / a» ripetute, e senza il valore non si capisce quale data
              si sta rendendo mobile. */}
          <Typography.Text>
            {c.etichetta}{' '}
            <Typography.Text type="secondary">(nella ricerca: {c.valore})</Typography.Text>
          </Typography.Text>
          <Space wrap style={{ display: 'flex', marginTop: 2 }}>
            <Select
              size="small"
              style={{ minWidth: 290 }}
              value={scelta.modo}
              options={opzioni}
              disabled={disabled}
              aria-label={`${c.etichetta}: come si muove`}
              onChange={(modo: string) => onChange(c.chiave, { ...scelta, modo })}
            />
            {scelta.modo === 'oggiMenoGiorni' && (
              // SXADV-6100.3: senza le frecce, come i campi numerici delle maschere
              // (NumberControl): nel campo piccolo coprivano il numero.
              <InputNumber
                size="small"
                controls={false}
                min={1}
                max={3650}
                value={scelta.giorni}
                disabled={disabled}
                aria-label={`${c.etichetta}: quanti giorni`}
                onChange={(giorni) => onChange(c.chiave, { ...scelta, giorni: Number(giorni) || 1 })}
              />
            )}
          </Space>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            {scelta.modo === 'fissa'
              ? `Resta sempre il ${c.valore}.`
              : oggi
                ? `Si sposta col calendario: se il widget si aggiornasse adesso, sarebbe il ${oggi}.`
                : 'Si sposta col calendario.'}
          </Typography.Text>
        </div>
      );
    })}
  </div>
);

export default DateDellaRicerca;
