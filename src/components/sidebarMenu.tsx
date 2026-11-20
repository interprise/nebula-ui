import React from 'react';
import type { Menu } from 'antd';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BuildOutlined,
  CalculatorOutlined,
  CarOutlined,
  ClusterOutlined,
  ContactsOutlined,
  ContainerOutlined,
  ControlOutlined,
  FileTextOutlined,
  HomeOutlined,
  IdcardOutlined,
  InboxOutlined,
  MessageOutlined,
  ProjectOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
  ScheduleOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  SolutionOutlined,
  TagsOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { MenuItem } from '../types/ui';
import '../styles/sidebarMenu.css';

/**
 * Il menu laterale (sidebar di Shell): voci e comportamento dei popup.
 *
 * Collassato, il menu e' una colonna di icone di modulo e le funzioni stanno in
 * popup che antd apre di fianco. Tre difetti dello stesso posto (collaudo del
 * 20/11/2026) avevano due cause sole:
 *
 * - **dove si apre il popup** (SXADV-6264): antd limita l'altezza del popup a
 *   `100vh - 100px` ma lo aggancia alla voce senza farlo rientrare nella finestra.
 *   Un modulo in fondo alla colonna (Utilita') lo apriva capovolto con testata e
 *   prime voci sopra il bordo; un sottomenu basso (Contabilita' > Fatt. attiva)
 *   lo apriva sotto il bordo, voci finali irraggiungibili. `shiftY` fa scorrere
 *   il popup in verticale finche' rientra; lo scorrimento interno resta di antd.
 * - **come si apre e si chiude** (SXADV-6270.1, 6271): a passaggio del mouse,
 *   uscire dal popup anche di poco (mirando la barra di scorrimento) lo
 *   richiudeva, e ogni popup ha il suo temporizzatore: trascinando la barra di un
 *   sottomenu il genitore si chiudeva e il figlio restava aperto da solo. A clic,
 *   i popup restano aperti finche' non si sceglie una funzione o si clicca fuori,
 *   e si chiudono insieme.
 */

/** Classe dei popup del menu laterale (fondo come l'area funzioni del menu espanso, SXADV-6270.2). */
export const SIDEBAR_POPUP_CLASS = 'sidebar-menu-popup';

type MenuProps = React.ComponentProps<typeof Menu>;

const KEEP_IN_VIEW = { adjustX: 1, adjustY: 1, shiftY: true } as const;
/** I piazzamenti di rc-menu (stessi punti di aggancio) con in piu' lo scorrimento verticale. */
const PLACEMENTS_IN_VIEW = {
  topLeft: { points: ['bl', 'tl'], overflow: KEEP_IN_VIEW },
  topRight: { points: ['br', 'tr'], overflow: KEEP_IN_VIEW },
  bottomLeft: { points: ['tl', 'bl'], overflow: KEEP_IN_VIEW },
  bottomRight: { points: ['tr', 'br'], overflow: KEEP_IN_VIEW },
  leftTop: { points: ['tr', 'tl'], overflow: KEEP_IN_VIEW },
  leftBottom: { points: ['br', 'bl'], overflow: KEEP_IN_VIEW },
  rightTop: { points: ['tl', 'tr'], overflow: KEEP_IN_VIEW },
  rightBottom: { points: ['bl', 'br'], overflow: KEEP_IN_VIEW },
};

/** Le props del `<Menu>` laterale che dipendono dallo stato collassato. Espanso
 *  (menu ad albero, niente popup) restano quelle di antd. */
export function sidebarMenuBehaviour(collapsed: boolean): Pick<MenuProps, 'triggerSubMenuAction' | 'builtinPlacements'> {
  if (!collapsed) return {};
  return { triggerSubMenuAction: 'click', builtinPlacements: PLACEMENTS_IN_VIEW };
}

// Semantic glyph per top-level Module, keyed on the bare module id (the server id
// arrives as "menu.<id>", so we strip the prefix before lookup — see moduleIconFor).
// Collapsed inline menus otherwise render every Module with the same fallback glyph,
// making them indistinguishable; a distinct icon per Module restores recognizability
// (SXADV-5454.0.b — one icon per primary menu).
const MODULE_ICONS: Record<string, React.ReactNode> = {
  cfg: <SettingOutlined />,              // Configurazioni
  allianz: <SafetyOutlined />,           // Allianz (assicurazioni)
  anag: <IdcardOutlined />,              // Anagrafiche
  ctb: <CalculatorOutlined />,           // Contabilità
  soci: <TeamOutlined />,                // Libro Soci
  art: <TagsOutlined />,                 // Articoli
  imm: <HomeOutlined />,                 // Immobiliare
  ven: <ShoppingCartOutlined />,         // Commerciale
  chub: <MessageOutlined />,             // Communication Hub
  acq: <ShoppingOutlined />,             // Acquisti
  proj: <ProjectOutlined />,             // Attività a progetto
  rap: <ScheduleOutlined />,             // Rapportini
  man: <ToolOutlined />,                 // Manutenzioni
  fat: <FileTextOutlined />,             // Fatturazione
  prod: <BuildOutlined />,               // Produzione
  int: <ApartmentOutlined />,            // Gestione Interna
  log: <CarOutlined />,                  // Logistica
  olap: <BarChartOutlined />,            // Statistiche
  util: <ControlOutlined />,             // Utilità
  age: <SolutionOutlined />,             // Sezione Agenti
  cli: <ContactsOutlined />,             // Sezione Clienti
  ant: <SafetyCertificateOutlined />,    // Antiriciclaggio
  dom: <ClusterOutlined />,              // Domino (hub anagrafiche uniche centralizzate)
  mag: <InboxOutlined />,                // Magazzino
  mct: <ContainerOutlined />,            // Magazzino Conto Terzi
};

function moduleIconFor(id: string): React.ReactNode {
  const bare = id.replace(/^menu\./, '');
  return MODULE_ICONS[bare] ?? <AppstoreOutlined />;
}

export function buildMenuItems(
  items: MenuItem[],
  level = 0,
  // Collapsed (icon-only) sidebar: the Module name is nowhere on screen, so the
  // flyout that opens on an icon has to carry it (SXADV-5454.6). Passed down
  // only to know we are at the root; brandBg paints the header band.
  collapsed = false,
  brandBg = '#1E4176',
): NonNullable<React.ComponentProps<typeof Menu>['items']> {
  return items.map((item) => {
    const icon = level === 0 ? moduleIconFor(item.id) : undefined;
    const children = item.children && item.children.length > 0
      ? buildMenuItems(item.children, level + 1, collapsed, brandBg)
      : undefined;
    return {
      key: item.id,
      label: item.description,
      title: item.description,
      // Tag top-level rows so CSS can render Modules distinctly from sub-functions,
      // and give each Module its own semantic glyph (unmapped Modules fall back to
      // AppstoreOutlined, so nothing regresses).
      ...(level === 0 ? { className: 'menu-module', icon } : {}),
      // Ogni sottomenu, a ogni livello: i popup del menu collassato si
      // riconoscono e prendono il fondo dell'area funzioni (SXADV-6270.2).
      ...(children ? { popupClassName: SIDEBAR_POPUP_CLASS } : {}),
      // Root Module, collapsed: wrap the functions in a group whose title is the
      // Module itself. antd renders the group title at the top of the flyout, so
      // the popup finally says which Module it belongs to; expanded, the parent
      // row already says it and the group would just repeat it.
      children: children && collapsed && level === 0
        ? [{
            type: 'group' as const,
            key: `${item.id}__module-header`,
            label: (
              <span className="menu-module-header" style={{ background: brandBg }}>
                {icon}
                <span className="menu-module-header-text">{item.description}</span>
              </span>
            ),
            children,
          }]
        : children,
    };
  });
}
