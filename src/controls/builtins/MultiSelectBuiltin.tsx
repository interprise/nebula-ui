import type { ControlComponent } from '../types';
import { getTextMaxWidth } from '../helpers';
import { useControlChange } from '../helpers';
import { withPostDecorations } from '../decorations';
import MultiSelectControl from '../MultiSelectControl';

const MultiSelectBuiltin: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  // Senza pastiglie la scelta si vede solo da quello che il server ne ricava (i
  // righi nel tab sotto): in dettaglio si ridisegna a Conferma, come il ritorno
  // dalla lista del legacy (SXADV-5859.c).
  const showsNoItems = control.maxItemsShown === 0 && pageType === 2;
  const handleChange = useControlChange(
    showsNoItems ? { ...control, reload: true, option1: (control.option1 as string) || (control.controlName as string) } : control,
    onChange,
    onAction,
  );
  const textMaxWidth = getTextMaxWidth(control);
  const isDisabled = !!control.disabled || control.editable === false;
  return withPostDecorations(
    <MultiSelectControl
      control={control}
      pageType={pageType}
      editable={!isDisabled}
      hint={control.hint}
      value={control.value}
      onChange={handleChange}
      onAction={onAction}
      maxWidth={textMaxWidth}
    />,
    // Niente catenella: l'elenco si apre gia' dalla cartella, e dalla catenella
    // arrivava senza la scelta selezionata (SXADV-5647.5).
    control.navigateView ? { ...control, navigateView: undefined } : control,
    pageType,
    onAction,
    onChange,
  );
};

export default MultiSelectBuiltin;
