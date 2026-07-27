import { useEffect, useReducer, useState } from 'react';
import { ColorPicker } from 'antd';
import type { AggregationColor } from 'antd/es/color-picker/color';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, getFieldName } from '../helpers';
import './HtmlAreaControl.css';

/** Rich-text (HTML) editor for the `HtmlArea` control type — e.g. the
 *  Info Banner "Testo Home Page" (banHpText). Backed by TipTap/ProseMirror;
 *  the stored field value is the serialized HTML (`editor.getHTML()`), matching
 *  the legacy ExtJS line which used CKEditor for the same field (SXADV-5526.1).
 *
 *  Value flow mirrors the other free-typing controls: keystrokes `store()` the
 *  HTML into the field ref on every change, and the optional `reload` round-trip
 *  fires only once on blur via `commit()` (see {@link useCommitReload}). */
const HtmlAreaControl: ControlComponent = ({ control, onAction, onChange }) => {
  const { disabled } = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const fieldName = getFieldName(control);
  const initialValue = typeof control.value === 'string' ? control.value : '';

  const editor = useEditor({
    // StarterKit brings bold/italic/underline/strike, headings, lists, quote,
    // hr and links. The text-style marks (Color/BackgroundColor) and TextAlign
    // round-trip the inline styles the legacy CKEditor emitted
    // (`<span style="background-color…/color…">`, `text-align:center`) so
    // editing an existing banner doesn't silently strip its formatting.
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      BackgroundColor,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: initialValue,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      // Serialize to HTML; an empty document stores '' (not TipTap's "<p></p>")
      // so mandatory checks and "no home-page text" reads stay correct.
      store(editor.isEmpty ? '' : editor.getHTML());
    },
    onBlur: () => commit(),
  });

  // Re-sync when the server sends a different value (form reload / round-trip).
  // The parent writes field edits to a ref without setState, so `control.value`
  // only changes on a real server render — no keystroke feedback loop here.
  useEffect(() => {
    if (!editor) return;
    const incoming = typeof control.value === 'string' ? control.value : '';
    const current = editor.isEmpty ? '' : editor.getHTML();
    if (incoming !== current) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [editor, control.value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      className={`htmlarea${disabled ? ' htmlarea-disabled' : ''}`}
      title={control.hint}
      style={{ width: '100%' }}
    >
      {editor && !disabled && <HtmlAreaToolbar editor={editor} />}
      <EditorContent editor={editor} id={control.id || fieldName} />
    </div>
  );
};

interface BtnProps {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}

function ToolbarButton({ label, title, active, onClick }: BtnProps) {
  return (
    <button
      type="button"
      title={title}
      className={active ? 'is-active' : undefined}
      // Keep focus in the editor so a selection-based command (bold/link) still
      // has a selection to act on.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** Preset swatches offered in the colour pickers — the common set plus the
 *  cyan/green/yellow highlights the legacy banners already use. */
const COLOR_PRESETS = [
  '#000000', '#595959', '#8c8c8c', '#bfbfbf', '#ffffff',
  '#ff0000', '#fa8c16', '#fadb14', '#00ff00', '#52c41a',
  '#00ffff', '#1677ff', '#722ed1', '#eb2f96', '#f5222d',
];

/** A toolbar colour picker (antd) that applies a `textStyle` colour attribute
 *  to the current selection. `attr` is the mark attribute we read to show the
 *  active swatch; `apply`/`clear` run the matching TipTap command. The trigger
 *  button mirrors the other toolbar buttons; the selection survives the popup
 *  because ProseMirror keeps its selection on blur and each command re-`focus()`es. */
function ColorTrigger({
  editor, title, label, attr, apply, clear,
}: {
  editor: Editor;
  title: string;
  label: string;
  attr: 'color' | 'backgroundColor';
  apply: (hex: string) => void;
  clear: () => void;
}) {
  const current = (editor.getAttributes('textStyle')[attr] as string) || undefined;
  // Controlled open so the popup closes as soon as a colour is chosen — the
  // legacy CKEditor picker dismissed on selection; leaving it open forces an
  // extra click-away.
  const [open, setOpen] = useState(false);
  return (
    <ColorPicker
      value={current}
      open={open}
      onOpenChange={setOpen}
      allowClear
      disabledAlpha
      presets={[{ label: 'Colori', colors: COLOR_PRESETS }]}
      onChangeComplete={(c: AggregationColor) => { apply(c.toHexString()); setOpen(false); }}
      onClear={() => { clear(); setOpen(false); }}
    >
      <button
        type="button"
        title={title}
        style={current ? { borderBottom: `3px solid ${current}`, height: 26 } : undefined}
      >
        {label}
      </button>
    </ColorPicker>
  );
}

/** Minimal formatting toolbar. Kept intentionally small — banner HTML needs
 *  basic inline styling, headings, lists and links, not a full word processor. */
function HtmlAreaToolbar({ editor }: { editor: Editor }) {
  // Force a re-render on every editor transaction so button active-state tracks
  // the current selection.
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on('transaction', force);
    editor.on('selectionUpdate', force);
    return () => {
      editor.off('transaction', force);
      editor.off('selectionUpdate', force);
    };
  }, [editor]);

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL del link:', prev || 'https://');
    if (url === null) return; // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const b = (label: string, title: string, active: boolean, onClick: () => void) => (
    <ToolbarButton label={label} title={title} active={active} onClick={onClick} />
  );

  return (
    <div className="htmlarea-toolbar">
      {b('B', 'Grassetto', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
      {b('I', 'Corsivo', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
      {b('U', 'Sottolineato', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run())}
      {b('S', 'Barrato', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run())}
      <span className="htmlarea-sep" />
      {b('H1', 'Titolo 1', editor.isActive('heading', { level: 1 }), () =>
        editor.chain().focus().toggleHeading({ level: 1 }).run())}
      {b('H2', 'Titolo 2', editor.isActive('heading', { level: 2 }), () =>
        editor.chain().focus().toggleHeading({ level: 2 }).run())}
      {b('¶', 'Paragrafo', editor.isActive('paragraph'), () => editor.chain().focus().setParagraph().run())}
      <span className="htmlarea-sep" />
      {b('• List', 'Elenco puntato', editor.isActive('bulletList'), () =>
        editor.chain().focus().toggleBulletList().run())}
      {b('1. List', 'Elenco numerato', editor.isActive('orderedList'), () =>
        editor.chain().focus().toggleOrderedList().run())}
      {b('❝', 'Citazione', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run())}
      <span className="htmlarea-sep" />
      {b('⯇', 'Allinea a sinistra', editor.isActive({ textAlign: 'left' }), () =>
        editor.chain().focus().setTextAlign('left').run())}
      {b('≡', 'Centra', editor.isActive({ textAlign: 'center' }), () =>
        editor.chain().focus().setTextAlign('center').run())}
      {b('⯈', 'Allinea a destra', editor.isActive({ textAlign: 'right' }), () =>
        editor.chain().focus().setTextAlign('right').run())}
      <span className="htmlarea-sep" />
      <ColorTrigger
        editor={editor}
        title="Colore testo"
        label="A"
        attr="color"
        apply={(hex) => editor.chain().focus().setColor(hex).run()}
        clear={() => editor.chain().focus().unsetColor().run()}
      />
      <ColorTrigger
        editor={editor}
        title="Colore sfondo"
        label="🖍"
        attr="backgroundColor"
        apply={(hex) => editor.chain().focus().setBackgroundColor(hex).run()}
        clear={() => editor.chain().focus().unsetBackgroundColor().run()}
      />
      <span className="htmlarea-sep" />
      {b('🔗', 'Inserisci/modifica link', editor.isActive('link'), setLink)}
      {b('⏎', 'Linea orizzontale', false, () => editor.chain().focus().setHorizontalRule().run())}
      {b('⨯', 'Rimuovi formattazione', false, () =>
        editor.chain().focus().unsetAllMarks().clearNodes().run())}
    </div>
  );
}

export default HtmlAreaControl;
