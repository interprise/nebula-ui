# EntrAsp React UI

React-based replacement for the legacy ExtJS 3.2 client of the EntrAsp/NebulaERP application.

## Project Overview

This is a **server-driven UI** architecture. The Java server owns all state and business logic; the React client is a pure renderer. The server sends a JSON UI tree describing the screen layout and controls; React renders it using Ant Design and AG Grid.

### Key Constraints
- **NO changes to domain/model Java code** — only CORE framework code may be modified
- **NO screen layout redesign** — screens must look the same as the legacy UI (same field placement, structure)
- **Protocol changes are OK** as long as they're in the CORE framework and transparent to domain code

## Architecture

### Three Repositories
| Repo | Path | Branch | Remote | Purpose |
|------|------|--------|--------|---------|
| CORE (NebulaFW) | `/home/luca/ui-new/CORE` | `react-ui` | `interprise/nebulafw` | Java framework — rendering engine, controllers, session management |
| entrasp | `/home/luca/ui-new/entrasp` | `react-ui` | `interprise/nebulaerp` | Java ERP application — domain code, views, custom controls |
| entrasp-ui | `/home/luca/ui-new/entrasp-ui` | `master` | `interprise/nebula-ui` | React client (this project) |

### Server-Side (CORE framework, already implemented)
The CORE `react-ui` branch replaces the HTML rendering pipeline with JSON:
- **JSONUIBuilder** (`CORE/.../JSONUIBuilder.java`) — Accumulates a JSON UI tree during rendering, replaces TransactionalWriter
- **UIControl.renderJSON()** — 31 control subclasses emit JSON descriptors instead of HTML
- **LayoutElement.renderJSON()** — Emits rows/cells with elementType, prompt, control
- **LayoutManager.renderJSON()** — Sets view metadata, renders list headers, footer buttons
- **ToolViewRenderer.renderJSONUI()** — Entry point: creates JSONUIBuilder, renders view, assembles response with ui + toolbar + uiData

### Client-Side (this project)
| File | Purpose |
|------|---------|
| `src/types/ui.ts` | TypeScript types matching JSON from server (UITree, UIRow, UICell, UIControl, ToolbarItem, ServerResponse, etc.) |
| `src/services/api.ts` | HTTP communication — login, logout, executeMenuItem, postAction, uploadFile. POSTs to `/entrasp/controller` and `/controller2` |
| `src/controls/ControlRenderer.tsx` | Maps control `type` string to Ant Design component (text, number, money, date, time, combo, boolean, button, lookup, etc.) |
| `src/components/ViewRenderer.tsx` | Renders JSON UI tree: rows → cells, dispatches on elementType (PROMPT, CONTENT, CONTAINER, SECTION_HEADER, SELECTOR, FILLER). Handles embedded views and tabs recursively |
| `src/components/ListRenderer.tsx` | Renders list views using AG Grid (v35 module API with themeAlpine) |
| `src/components/Toolbar.tsx` | Per-view toolbar buttons from server response |
| `src/components/Shell.tsx` | Main app shell — vertical app bar (general ops), sidebar menu with search filter, tabbed content area, header with breadcrumbs |
| `src/components/LoginForm.tsx` | Login screen, sends JSONMenu action |
| `src/App.tsx` | Root — LoginForm or Shell based on auth state, Italian locale |
| `src/styles/global.css` | Layout table, section headers, app bar, toolbar styling |

## Communication Protocol

### Endpoints
- `/entrasp/controller` (CMD_URL) — Primary: view actions, form posts, navigation
- `/entrasp/controller2` (CMD2_URL) — Auth, menu, global operations

### Key Request Parameters
- `action` — Command name (Post, Save, Delete, ExecuteMenuItem, JSONMenu, Refresh, etc.)
- `sid` — Session ID (S1, S2, ... for tabs; A1 for agenda; J0 for jobs)
- `menuId` — Menu item identifier
- `navpath`, `option1`, `option2`, `option3` — Navigation parameters
- `messages` — Confirmation dialog responses (mnemonic,Y/N)
- Form field values sent as URL-encoded POST body

### Server Response Structure
```json
{
  "ui": { "rows": [...], "path": "...", "pageType": 0|1|2, "viewName": "...", "title": "..." },
  "toolbar": [{ "id": "...", "text": "...", "icon": "...", "handler": "...", "disabled": false }],
  "currField": "fieldId",
  "uiData": { "jsChecks": {}, "scrollPos": 0, "controls": [], "navMap": {} },
  "errors": [{ "type": "ERROR|WARNING|CONFIRMATION", "message": "...", "mnemonic": "..." }],
  "loginfo": { "login": "...", "profile": "...", "customerKey": "...", ... }
}
```

### Element Types (from LayoutElement.java)
```
ELTYPE_PROMPT=0, ELTYPE_CONTENT=1, ELTYPE_SECTION_HEADER=3, ELTYPE_SECTION_CONTENT=4,
ELTYPE_SELECTOR=5, ELTYPE_INDENT=6, ELTYPE_FILLER=7, ELTYPE_CONTAINER=8, ELTYPE_DUMMY=9
```

### Control Types (from UIControl subclasses)
text, number, money, date, time, timestamp, durata, boolean, checkbox, combo (local/remote), multiselect, textarea, password, htmlarea, button, action, windowButton, lookup, navigateView, add, upload, download, barcode, url, html, hint, highlight, tab, embeddedView, detailView

## UI Layout Decisions
- **Vertical app bar** (48px, far left): General operations toolbar with icon-only buttons (logout, change password, email, agenda, docs, new session, help, CDMS, notifications, etc.). Moved from horizontal-above-menu to vertical to accommodate growing button count.
- **Sidebar menu** (260px, collapsible): Filterable — text input at top filters the tree, keeping matching nodes with their ancestor path visible, auto-expanding all parent nodes during filtering.
- **Tabbed content area**: Each menu item opens in its own tab with independent session (sid), form state, and view state.

## Tech Stack
- React 19, TypeScript, Vite 7
- Ant Design 6 (with Italian locale)
- AG Grid Community 35 (module API, themeAlpine)
- dayjs (via antd dependency)

## Build
```bash
npm run dev      # Vite dev server on :5173, proxies /entrasp/controller* and /entrasp/images to :8080
npm run build    # Output to ../entrasp/WebContent/app/
```

Build produces code-split chunks: app (~23KB), antd vendor, AG Grid vendor.

## What's Left To Do
- [ ] Handle entrasp custom UIControls (`entrasp/src/.../view/*UIControl.java`) — add getJsonType()/renderJSON()
- [ ] End-to-end testing with running server
- [ ] Keyboard navigation and shortcut handling (toolbar keys/shift hints)
- [ ] Remote combo filtering (ListFilter action integration)
- [ ] File upload integration
- [ ] Progress tracking for long operations (polling JSONProgress)
- [ ] CKEditor integration for htmlarea controls
- [ ] Responsive behavior when sidebar collapses
- [ ] Agenda sidebar panel
- [ ] Print/export functionality
