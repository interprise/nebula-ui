import React from 'react';
import type { UIControl } from '../types/ui';

/** Didascalia di una scelta fatta da un elenco che la vista non porta con se'
 *  (combo remoto: la voce; selezione multipla: le voci). Il valore spedito e'
 *  solo il codice, ma per ridisegnare il campo tornando sulla scheda serve
 *  anche quello che l'utente ha visto scegliere (SXADV-5989). */
export type FieldCaption = string | { value: string; text: string; listText?: string }[];

/** Scrive il valore di un campo nello stato di sessione della scheda. */
export type FieldChange = (name: string, value: unknown, caption?: FieldCaption) => void;

export interface ControlComponentProps {
  control: UIControl;
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: FieldChange;
}

export type ControlComponent = React.FC<ControlComponentProps>;
