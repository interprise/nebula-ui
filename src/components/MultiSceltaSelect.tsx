import React from 'react';
import { Select, type SelectProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

export type MultiSceltaSelectProps = Omit<SelectProps<string[]>, 'mode' | 'allowClear' | 'suffixIcon'>;

/**
 * Un campo a scelte multiple (le "pastiglie") — SXADV-6268.
 *
 * A destra niente X «togli tutto»: con le scelte gia' fatte il gesto che ci si
 * aspetta li' e' aggiungerne altre, e la X, che compariva proprio sotto il
 * puntatore, le cancellava tutte in un clic distratto. Al suo posto la lente,
 * sempre visibile, che apre la tendina. Togliere resta possibile una scelta
 * alla volta (la X di ogni pastiglia) o da tastiera (Backspace nel campo vuoto
 * toglie l'ultima): sono gesti di antd, non tocchi qui.
 *
 * Ogni Select a scelte multiple del client passa di qui, cosi' il comportamento
 * e' lo stesso ovunque.
 */
const MultiSceltaSelect: React.FC<MultiSceltaSelectProps> = (props) => (
  <Select<string[]>
    {...props}
    mode="multiple"
    allowClear={false}
    // Un clic sulla lente cade nel selettore, che apre la tendina come un clic
    // nel campo (e la richiude se e' gia' aperta): nessun gestore proprio. E'
    // decorativa per i lettori di schermo: da tastiera si apre con Freccia giu'.
    suffixIcon={<SearchOutlined aria-hidden />}
  />
);

export default MultiSceltaSelect;
