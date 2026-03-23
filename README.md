# Vibe Mermaid Diagram Editor

➡️ Try it out here: <a href="https://dusklight.github.io/vibe-mermaid-editor/" target="_blank" rel="noopener noreferrer">Vibe Mermaid Diagram Editor</a>

A fully client-side, zero-installation browser app for creating and exporting Mermaid diagrams.

🤖 Completely vibe-coded: Built using Sonnet 4.6 and GPT-5.4 via ~30 chat interactions in the VS Code Copilot and Codex extensions.

![Vibe Mermaid Diagram Editor screenshot](./assets/VibeMermaidEditorScreenshot2026-03-22.png)

---

## Features

- **Source round-tripping** — exported files embed the original Mermaid source (PNG: `tEXt` chunk; SVG: `data-mermaid-source` attribute). Drag an exported file back in to instantly restore the diagram.
    - **Export options** — PNG (1×, 2×, or current zoom), SVG, or preview in a new tab without saving.
    - **Drag-and-drop import** — drop a PNG, SVG, `.mmd`, or `.md` file onto the editor or preview pane to load it.
- **Multi-tab editing** — independent editor state, zoom, and pan per tab.
- **Live split-pane editing** — resizable editor/preview layout with auto-render option or manual render via **Ctrl+Enter**.
- **Four layout engines** — Dagre (default), ELK (with advanced node/edge controls), Tidy Tree, and Cose Bilkent.
- **14 built-in templates** — Flowchart, Sequence, Class, State, ER, Gantt, Pie, Mind Map, Git Graph, Timeline, Quadrant Chart, XY Chart, User Journey, C4 Diagram.
- **Rich code editor** — Syntax highlighting, bracket matching, auto-close, find/replace, autocomplete, line wrap toggle, and a status bar with inline parse errors.
- **Zoom, pan, and fit** — mouse-wheel zoom, click-and-drag pan, pinch-to-zoom, fit-to-screen (**Ctrl+Shift+F**), and a custom zoom input.
- **Five diagram themes** — Default, Neutral, Dark, Forest, Base.
- **Dark/light app theme** — single toggle in the header.

---

## Project structure

```
/
├── index.html        # Single HTML page; markup, CDN imports, UI wiring
├── css/
│   └── styles.css    # All styles; CSS custom properties (design tokens) at the top
└── js/
    └── app.js        # All application logic, implemented as one async IIFE
```

## Architecture

The entire application is a single async IIFE (`app.js`) that boots after the CDN modules resolve. Inside it, logical concerns are separated into module-like closures that return explicit public APIs:

| Closure | Responsibility |
|---|---|
| `MermaidEditorMermaidApi` | Wraps the Mermaid library; handles layout engine registration, configuration, and the off-screen render host |
| `MermaidEditorTemplates` | Owns the 14 built-in diagram templates and the default diagram shown on first load |
| `MermaidEditorExport` | PNG and SVG export/import; source embedding and extraction; CRC32 for PNG `tEXt` chunks |
| `MermaidEditorPreview` | Rendering pipeline, zoom/pan state, debounced render scheduling, Mermaid theme switching |

The main body of the IIFE wires these modules together and owns the DOM interactions (tabs, toolbar buttons, CodeMirror setup, keyboard shortcuts, drag-and-drop, local-storage persistence).

## Styling conventions

`styles.css` is built around CSS custom properties. All colors, spacing constants, and component-level tokens are declared once in `:root` and overridden in `body.dark`. To change a color scheme, only the token declarations need to change — no selector hunting required.

## Source embedding implementation

The round-trip import/export feature is implemented entirely in `MermaidEditorExport` without any external library:

- **PNG**: A conforming `tEXt` chunk is constructed by hand — 4-byte length, 4-byte type, keyword + NUL + value payload, and a CRC-32 checksum computed with a precomputed lookup table. The chunk is spliced into the PNG binary immediately after the `IHDR` chunk.
- **SVG**: The source is UTF-8 encoded, then base64-encoded with `btoa`, and written as a `data-mermaid-source` attribute on the root `<svg>` element before the file is saved.

On import, both paths are reversed: PNG chunks are walked to find `MermaidSource`, and the SVG attribute value is base64-decoded.

## No build step

There is intentionally no bundler, transpiler, or build tool. The codebase uses native ES modules (`import()` for async CDN loads) and plain JavaScript.

## Local storage

Tab content, the active tab index, and the current Mermaid diagram theme are persisted to `localStorage` automatically, so work is not lost on a page reload.
