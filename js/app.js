(async function () {
    const bootError = message => {
        const target = document.getElementById('diagram-wrapper') || document.body;
        const escaped = String(message)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        target.innerHTML = `
            <div class="render-error" style="margin:40px auto; max-width:640px;">
                <div class="render-error-title">Unable to start Mermaid editor</div>
                <pre class="render-error-pre">${escaped}</pre>
            </div>`;
    };

    try {
        // Single place to change when bumping the Mermaid build; the ELK layout
        // engine ships inside Mermaid, so only the optional tidy-tree layout
        // loader has to be fetched separately.
        const MERMAID_VERSION = '12.3.0';
        const [
            { default: mermaid },
            { default: tidyTreeLayouts },
        ] = await Promise.all([
            import(`https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.esm.min.mjs`),
            import('https://cdn.jsdelivr.net/npm/@mermaid-js/layout-tidy-tree@1.0.1/dist/mermaid-layout-tidy-tree.esm.min.mjs'),
        ]);

        // ── Shared utility: parse diagram type from source text ──────────────────
        /**
         * Return the diagram keyword of a source string.
         * YAML frontmatter blocks (`---\nconfig: …\n---`) and `%%` comments are skipped,
         * so directives at the top of a diagram do not masquerade as the diagram type.
         * @param {string} src
         * @returns {string}
         */
        function parseDiagramType(src) {
            const lines = String(src || '').split(/\r?\n/);
            let seenKeywordLine = false;
            let inFrontmatter  = false;

            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line) continue;

                // Frontmatter is only valid before the first diagram keyword line.
                if (!seenKeywordLine && line === '---') {
                    inFrontmatter = !inFrontmatter;
                    continue;
                }
                if (inFrontmatter) continue;
                if (line.startsWith('%%')) continue;

                const m = line.match(/^!?([\w-]+)/);
                if (!m) continue;
                seenKeywordLine = true;
                return m[1];
            }
            return 'diagram';
        }

        const MermaidEditorMermaidApi = (() => {
mermaid.registerLayoutLoaders(tidyTreeLayouts);

// Theme names implemented by the loaded Mermaid build.
const MERMAID_THEMES = Object.freeze([
    'default', 'neutral', 'base', 'dark', 'forest',
    'neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color',
]);
const DARK_MERMAID_THEMES = new Set([
    'dark', 'neo-dark', 'redux-dark', 'redux-dark-color',
]);

const SUPPORTED_LAYOUTS = new Set(['elk', 'tidy-tree', 'cose-bilkent', 'dagre']);
const SUPPORTED_LOOKS   = new Set(['auto', 'classic', 'neo', 'handDrawn']);
const SUPPORTED_PLACEMENTS = new Set(['BRANDES_KOEPF', 'LINEAR_SEGMENTS', 'NETWORK_SIMPLEX', 'SIMPLE']);
const SUPPORTED_BIT_ORDERS = new Set(['ascending', 'descending']);
const SUPPORTED_MINDMAP_COLOR_BY = new Set(['branch', 'depth']);

// Layout engines that some diagram types reject (measured against the loaded
// Mermaid build). All other types either support the engine or ignore the setting.
const LAYOUT_UNSUPPORTED_BY_DIAGRAM = new Map([
    // The bundled ELK engine has no mindmap layout; passing it makes
    // the cytoscape-based mindmap renderer throw ("reading 'pe'").
    ['elk', new Set(['mindmap'])],
    ['cose-bilkent', new Set([
        'flowchart', 'graph', 'classDiagram', 'classDiagram-v2', 'stateDiagram',
        'stateDiagram-v2', 'erDiagram', 'requirementDiagram', 'usecase',
        'usecase-beta', 'agentflow', 'agentflow-beta', 'swimlane', 'swimlane-beta',
    ])],
    ['tidy-tree', new Set([
        'agentflow', 'agentflow-beta', 'swimlane', 'swimlane-beta',
    ])],
]);

// Defaults matching the loaded Mermaid build: ELK layout engine,
// library-managed look per diagram type.
const DEFAULT_OPTIONS = Object.freeze({
    layout: 'elk',
    look: 'auto',
    inheritDir: false,
    elkNodePlacementStrategy: 'BRANDES_KOEPF',
    elkMergeEdges: false,
    elkOrientFeedbackEdges: true,
    elkKeepEntryNodeOnTop: false,
    elkStraightenEdges: true,
    elkLineHops: true,
    flowchartStepNumbers: false,
    flowchartStepDuration: 1,
    mindmapColorBy: 'branch',
    packetBitOrder: 'ascending',
    xyChartShowLegend: true,
    xyChartShowDataLabel: false,
});

let currentOptions = { ...DEFAULT_OPTIONS };
let renderHost = null;

function asBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function asEnum(value, allowed, fallback) {
    return allowed.has(value) ? value : fallback;
}

function asStepDuration(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(30, Math.max(0.1, n));
}

function normalizeLayoutOptions(nextOptions = {}) {
    const d = DEFAULT_OPTIONS;
    return {
        layout:                   asEnum(nextOptions.layout, SUPPORTED_LAYOUTS, d.layout),
        look:                     asEnum(nextOptions.look, SUPPORTED_LOOKS, d.look),
        inheritDir:               asBoolean(nextOptions.inheritDir, d.inheritDir),
        elkNodePlacementStrategy: asEnum(nextOptions.elkNodePlacementStrategy, SUPPORTED_PLACEMENTS, d.elkNodePlacementStrategy),
        elkMergeEdges:            asBoolean(nextOptions.elkMergeEdges, d.elkMergeEdges),
        elkOrientFeedbackEdges:   asBoolean(nextOptions.elkOrientFeedbackEdges, d.elkOrientFeedbackEdges),
        elkKeepEntryNodeOnTop:    asBoolean(nextOptions.elkKeepEntryNodeOnTop, d.elkKeepEntryNodeOnTop),
        elkStraightenEdges:       asBoolean(nextOptions.elkStraightenEdges, d.elkStraightenEdges),
        elkLineHops:              asBoolean(nextOptions.elkLineHops, d.elkLineHops),
        flowchartStepNumbers:     asBoolean(nextOptions.flowchartStepNumbers, d.flowchartStepNumbers),
        flowchartStepDuration:    asStepDuration(nextOptions.flowchartStepDuration, d.flowchartStepDuration),
        mindmapColorBy:           asEnum(nextOptions.mindmapColorBy, SUPPORTED_MINDMAP_COLOR_BY, d.mindmapColorBy),
        packetBitOrder:           asEnum(nextOptions.packetBitOrder, SUPPORTED_BIT_ORDERS, d.packetBitOrder),
        xyChartShowLegend:        asBoolean(nextOptions.xyChartShowLegend, d.xyChartShowLegend),
        xyChartShowDataLabel:     asBoolean(nextOptions.xyChartShowDataLabel, d.xyChartShowDataLabel),
    };
}

function isLayoutSupported(layout, diagramType) {
    if (!diagramType) return true;
    const blocked = LAYOUT_UNSUPPORTED_BY_DIAGRAM.get(layout);
    return !(blocked && blocked.has(diagramType));
}

/**
 * Resolve which `layout` value to hand to Mermaid for a given diagram type.
 * Engines a diagram type rejects (e.g. cose-bilkent for flowcharts) are dropped
 * so the diagram falls back to its own built-in default instead of failing.
 */
function resolveLayout(layout, diagramType) {
    return isLayoutSupported(layout, diagramType) ? layout : undefined;
}

function buildConfig(theme, htmlLabels, diagramType) {
    const layout = resolveLayout(currentOptions.layout, diagramType);
    const config = {
        startOnLoad: false,
        theme,
        securityLevel: 'loose',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
        htmlLabels,
        darkMode: DARK_MERMAID_THEMES.has(theme),
        elk: {
            mergeEdges:            currentOptions.elkMergeEdges,
            nodePlacementStrategy: currentOptions.elkNodePlacementStrategy,
            orientFeedbackEdges:   currentOptions.elkOrientFeedbackEdges,
            keepEntryNodeOnTop:    currentOptions.elkKeepEntryNodeOnTop,
            straightenEdges:       currentOptions.elkStraightenEdges,
            lineHops:              currentOptions.elkLineHops,
        },
        flowchart: {
            inheritDir:    currentOptions.inheritDir,
            nodeSpacing:   50,
            rankSpacing:   50,
            // step-by-step edge animation
            stepNumbers:   currentOptions.flowchartStepNumbers,
            stepDuration:  currentOptions.flowchartStepDuration,
        },
        mindmap: {
            // depth-based mindmap coloring
            colorBy: currentOptions.mindmapColorBy,
        },
        packet: {
            // highest-bit-first rows
            bitOrder: currentOptions.packetBitOrder,
        },
        xyChart: {
            // series legend, plus per-point data labels
            showLegend:    currentOptions.xyChartShowLegend,
            showDataLabel: currentOptions.xyChartShowDataLabel,
        },
    };

    if (layout) config.layout = layout;
    // 'auto' lets each diagram type keep its own built-in default look (neo for most).
    if (currentOptions.look !== 'auto') config.look = currentOptions.look;

    return config;
}

function isValidMermaidTheme(theme) {
    return MERMAID_THEMES.includes(theme);
}

/**
 * Engine Mermaid itself uses when the configured one is rejected by a diagram
 * type. Only combinations listed in LAYOUT_UNSUPPORTED_BY_DIAGRAM get here.
 */
const DIAGRAM_DEFAULT_LAYOUT = new Map([
    ...['flowchart', 'graph', 'classDiagram', 'classDiagram-v2', 'stateDiagram',
        'stateDiagram-v2', 'erDiagram', 'requirementDiagram', 'usecase',
        'usecase-beta', 'agentflow', 'agentflow-beta', 'swimlane', 'swimlane-beta',
    ].map(type => [type, 'elk']),
    ['mindmap', 'cose-bilkent'],
]);

/** Effective layout for a diagram type, honouring per-diagram fallbacks. */
function getEffectiveLayout(diagramType) {
    const resolved = resolveLayout(currentOptions.layout, diagramType);
    if (resolved) return resolved;
    return DIAGRAM_DEFAULT_LAYOUT.get(diagramType) || 'the diagram’s built-in renderer';
}

function initializeMermaid(theme = 'default', htmlLabels = true, diagramType = undefined) {
    mermaid.initialize(buildConfig(theme, htmlLabels, diagramType));
}

function getMermaidRenderHost() {
    if (renderHost) return renderHost;
    renderHost = document.createElement('div');
    renderHost.id = 'mermaid-render-host';
    renderHost.setAttribute('aria-hidden', 'true');
    renderHost.style.position = 'fixed';
    renderHost.style.left = '-10000px';
    renderHost.style.top = '-10000px';
    renderHost.style.width = '1920px';
    renderHost.style.height = '1080px';
    renderHost.style.overflow = 'hidden';
    renderHost.style.opacity = '0';
    renderHost.style.pointerEvents = 'none';
    document.body.appendChild(renderHost);
    return renderHost;
}

function setMermaidLayoutOptions(nextOptions = {}) {
    currentOptions = normalizeLayoutOptions({
        ...currentOptions,
        ...nextOptions,
    });
}

function getMermaidLayoutOptions() {
    return { ...currentOptions };
}

function getDefaultMermaidLayoutOptions() {
    return { ...DEFAULT_OPTIONS };
}

            return {
                initializeMermaid,
                getMermaidRenderHost,
                setMermaidLayoutOptions,
                getMermaidLayoutOptions,
                getDefaultMermaidLayoutOptions,
                normalizeLayoutOptions,
                isValidMermaidTheme,
                isLayoutSupported,
                getEffectiveLayout,
                MERMAID_THEMES,
                MERMAID_VERSION,
                mermaid,
            };
        })();

        const MermaidEditorTemplates = (() => {
/**
 * templates.js — Built-in diagram templates for the Mermaid Editor.
 */

const TEMPLATES = [
    // ── Core diagrams ───────────────────────────────────────────────────────
    {
        id: 'flowchart',
        group: 'Core diagrams',
        label: 'Flowchart',
        source: `flowchart LR
    A([Start]) --> B{Decision?}
    B -->|Yes| C[Process A]
    B -->|No| D[Process B]
    C --> E([End])
    D --> E`
    },
    {
        id: 'sequence',
        group: 'Core diagrams',
        label: 'Sequence Diagram',
        source: `sequenceDiagram
    participant A as Alice
    participant B as Bob
    participant S as Server

    A->>S: Hello Server!
    S-->>A: Connection OK
    A->>B: Hey Bob, we are connected!
    B-->>A: Great news!`
    },
    {
        id: 'class',
        group: 'Core diagrams',
        label: 'Class Diagram',
        source: `classDiagram
    class Animal {
        +String name
        +int age
        +makeSound() String
    }
    class Dog {
        +String breed
        +fetch() void
    }
    class Cat {
        +purr() void
    }
    Animal <|-- Dog
    Animal <|-- Cat`
    },
    {
        id: 'state',
        group: 'Core diagrams',
        label: 'State Diagram',
        source: `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : start
    Processing --> Idle : cancel
    Processing --> Done : finish
    Done --> [*]

    state Processing {
        [*] --> Validating
        Validating --> Executing
        Executing --> [*]
    }`
    },
    {
        id: 'er',
        group: 'Core diagrams',
        label: 'ER Diagram',
        source: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ ORDER-ITEM : contains
    PRODUCT ||--o{ ORDER-ITEM : "ordered in"

    CUSTOMER {
        string name
        string email
    }
    ORDER {
        int id
        date created_at
    }
    PRODUCT {
        string name
        float price
    }

    subgraph fulfilment [Fulfilment]
        SHIPMENT ||--|{ SHIPMENT-ITEM : contains
        SHIPMENT {
            date shipped
        }
    end

    ORDER ||--|| SHIPMENT : ships`
    },
    {
        id: 'c4',
        group: 'Core diagrams',
        label: 'C4 Diagram',
        source: `C4Context
    title System Context Diagram for Online Shop

    Person(customer, "Customer", "A shopper using the online store")
    Person(admin, "Store Admin", "Manages inventory and orders")

    System(webApp, "Online Shop", "Allows customers to browse and purchase products")

    System_Ext(paymentGateway, "Payment Gateway", "Handles secure payment processing")
    SystemDb_Ext(emailSystem, "Email System", "Sends order and shipping notifications")

    Rel(customer, webApp, "Browses and orders from", "HTTPS")
    Rel(admin, webApp, "Manages inventory via", "HTTPS")
    Rel(webApp, paymentGateway, "Processes payments via", "HTTPS/API")
    Rel(webApp, emailSystem, "Sends emails via", "SMTP")
    Rel(emailSystem, customer, "Delivers notifications to")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")`
    },
    {
        id: 'usecase',
        group: 'Core diagrams',
        label: 'UML Use Case',
        source: `usecase-beta
direction LR

actor Customer
actor Support

systemBoundary Storefront
    Browse("Browse catalogue")
    Checkout("Checkout")
end

systemBoundary Fulfilment
    Track("Track delivery")
end

Customer --> Browse
Customer --> Checkout
Customer --> Track
Support --> Track

Checkout ..> : include Browse`
    },
    {
        id: 'swimlane',
        group: 'Core diagrams',
        label: 'Swimlanes',
        source: `swimlane-beta LR
    subgraph Customer
        request[Request support]
        receive[Receive update]
    end

    subgraph Support
        triage[Triage request]
        answer[Send answer]
    end

    subgraph Engineering
        investigate[Investigate issue]
        fix[Prepare fix]
    end

    request --> triage
    triage -->|Known issue| answer
    triage -->|Needs code change| investigate
    investigate --> fix --> answer
    answer --> receive`
    },
    {
        id: 'agentflow',
        group: 'Core diagrams',
        label: 'Agentflow',
        source: `agentflow-beta TB
    brief["Release brief"]@{ shape: input }

    flow writer["Drafting Agent"]
        draft["Draft the notes"]@{ shape: task }
        lookup["changelog_search"]@{ shape: tool }
        guide["Tone of voice"]@{ shape: refdoc }
        draft --> lookup
        draft -.- guide
    end

    flow reviewer["Review Agent"]
        check["Check the claims"]@{ shape: task }
        ok["Accurate?"]@{ shape: decision }
        check --> ok
    end

    publish["Publish"]@{ shape: action }

    brief --> writer
    writer --> reviewer
    ok --> publish`
    },
    {
        id: 'requirement',
        group: 'Core diagrams',
        label: 'Requirement Diagram',
        source: `requirementDiagram

    requirement checkout_req {
        id: 1
        text: Orders must be payable online.
        risk: high
        verifymethod: test
    }

    functionalRequirement payment_req {
        id: 1.1
        text: Card payments must be authorised.
        risk: high
        verifymethod: test
    }

    element checkout_service {
        type: service
    }

    checkout_req - contains -> payment_req
    checkout_service - satisfies -> payment_req`
    },

    // ── Flowchart extras ────────────────────────────────────────────────────
    {
        id: 'flowchart-shapes',
        group: 'Flowchart extras',
        label: 'New shapes (person, browser…)',
        source: `flowchart LR
    engineer["Support engineer"]@{ shape: person }
    app["Web app"]@{ shape: browser }
    shell["Shell"]@{ shape: console }
    repo["Source repo"]@{ shape: folder }
    blobs["Object store"]@{ shape: bucket }

    engineer --> app
    app --> shell
    app --> repo
    repo --> blobs`
    },
    {
        id: 'flowchart-collapse',
        group: 'Flowchart extras',
        label: 'Collapsible subgraph',
        source: `flowchart TD
    Start([Start]) --> ingest

    subgraph ingest [Ingestion pipeline]
        parse[Parse] --> enrich[Enrich]
        enrich --> index[Index]
    end

    ingest --> store[(Warehouse)]
    ingest@{ view: collapsed }`
    },
    {
        id: 'flowchart-steps',
        group: 'Flowchart extras',
        label: 'Step-by-step edge animation',
        source: `flowchart LR
    Client e1@--> API
    API e2@--> Cache
    Cache e3@-->|miss| DB
    DB e4@--> API
    API e5@--> Client

    e1@{ step: 1 }
    e2@{ step: 2 }
    e3@{ step: 3 }
    e4@{ step: 4 }
    e5@{ step: 5 }`
    },
    {
        id: 'flowchart-bpmn',
        group: 'Flowchart extras',
        label: 'BPMN shapes & markers',
        source: `flowchart LR
    start@{ shape: bpmn-start } --> order["Place order"]@{ shape: bpmn-activity }
    order --> gw{"In stock?"}@{ shape: bpmn-gateway, type: exclusive }
    gw -->|yes| ship["Ship it"]@{ shape: bpmn-activity, marker: loop }
    gw -->|no| backorder["Back-order"]@{ shape: bpmn-activity, marker: parallel }
    ship --> done@{ shape: bpmn-end }
    backorder --> done
    catalog["Catalogue"]@{ shape: bpmn-data } -.- order
    crm["CRM store"]@{ shape: bpmn-data-store } -.- ship`
    },

    // ── Charts & data ───────────────────────────────────────────────────────
    {
        id: 'gantt',
        group: 'Charts & data',
        label: 'Gantt Chart',
        source: `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD

    section Planning
        Requirements   :a1, 2024-01-01, 14d
        Design         :a2, after a1, 10d

    section Development
        Backend        :b1, after a2, 21d
        Frontend       :b2, after a2, 18d

    section Testing
        Integration    :c1, after b1, 7d
        UAT            :after c1, 5d`
    },
    {
        id: 'pie',
        group: 'Charts & data',
        label: 'Pie Chart',
        source: `pie title Browser Market Share
    "Chrome"  : 65.0
    "Safari"  : 19.4
    "Firefox" : 4.1
    "Edge"    : 4.0
    "Other"   : 7.5`
    },
    {
        id: 'quadrant',
        group: 'Charts & data',
        label: 'Quadrant Chart',
        source: `quadrantChart
    title Reach and Engagement
    x-axis "Low Reach" --> "High Reach"
    y-axis "Low Engagement" --> "High Engagement"
    quadrant-1 Grow
    quadrant-2 Needs attention
    quadrant-3 Re-evaluate
    quadrant-4 May be improved
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
    Campaign C: [0.57, 0.69]
    Campaign D: [0.78, 0.34]`
    },
    {
        id: 'xychart',
        group: 'Charts & data',
        label: 'XY Chart (named series → legend)',
        source: `xychart-beta
    title "Monthly Revenue vs Target"
    x-axis [Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec]
    y-axis "Revenue (USD)" 4000 --> 12000
    bar  "Revenue" [5000, 6000, 7500, 8200, 9000, 9500, 9800, 10200, 9800, 10500, 11000, 10800]
    line "Target"   [5500, 6200, 7000, 8000, 9000, 9500, 10000, 10500, 10500, 11000, 11500, 11500]`
    },
    {
        id: 'xychart-points',
        group: 'Charts & data',
        label: 'XY Chart point labels',
        source: `xychart-beta
    title "Smallest AI models scoring above 60% on MMLU"
    x-axis "Date" ["Apr 2022", "Feb 2023", "Jul 2023", "Sep 2023", "Apr 2024"]
    y-axis "Parameters (B)" 0 --> 600
    line [540 "PaLM", 65 "LLaMA-65B", 34 "Llama 2 34B", 7 "Mistral 7B", 3.8 "Phi-3-mini"]`
    },
    {
        id: 'radar',
        group: 'Charts & data',
        label: 'Radar Chart',
        source: `radar-beta
    title Team skills
    axis analysis["Analysis"], build["Build"], test["Test"], deploy["Deploy"], monitor["Monitor"]
    curve platform["Platform team"]{4, 5, 3, 4, 2}
    curve product["Product team"]{3, 3, 4, 2, 4}
    max 5
    min 0
    graticule polygon
    ticks 5`
    },
    {
        id: 'sankey',
        group: 'Charts & data',
        label: 'Sankey Diagram',
        source: `sankey-beta

Traffic,Organic search,420
Traffic,Referral,180
Traffic,Paid ads,150
Organic search,Sign-ups,120
Referral,Sign-ups,90
Paid ads,Sign-ups,40
Sign-ups,Trial,210
Sign-ups,Bounce,40
Trial,Paid plan,60
Trial,Churn,150`
    },
    {
        id: 'packet',
        group: 'Charts & data',
        label: 'Packet Diagram',
        source: `packet-beta
0-15: "Source port"
16-31: "Destination port"
32-63: "Sequence number"
64-95: "Acknowledgement number"
96-99: "Data offset"
100-105: "Reserved bits"
106-111: "Flags"
112-127: "Window size"`
    },
    {
        id: 'timeline',
        group: 'Charts & data',
        label: 'Timeline',
        source: `timeline
    title History of the Web
    1991 : World Wide Web invented
    1993 : Mosaic browser released
    1995 : JavaScript created
    2004 : Gmail launches
         : Facebook founded
    2007 : iPhone announced
    2009 : Node.js created`
    },
    {
        id: 'userjourney',
        group: 'Charts & data',
        label: 'User Journey',
        source: `journey
    title Online Shopping Experience
    section Browse
      Visit homepage: 5: Customer
      Search for product: 4: Customer
      View product details: 4: Customer
    section Purchase
      Add to cart: 5: Customer
      Enter shipping info: 3: Customer
      Enter payment info: 2: Customer
      Confirm order: 4: Customer
    section Post-Purchase
      Receive confirmation email: 5: Customer, System
      Track shipment: 4: Customer
      Receive package: 5: Customer`
    },

    // ── Structure & planning ────────────────────────────────────────────────
    {
        id: 'mindmap',
        group: 'Structure & planning',
        label: 'Mind Map',
        source: `mindmap
  root((Project))
    Planning
      Requirements
      Timeline
    Development
      Backend
        API
        Database
      Frontend
        UI
        UX
    Testing
      Unit Tests
      E2E Tests`
    },
    {
        id: 'treeview',
        group: 'Structure & planning',
        label: 'Tree View',
        source: `treeView-beta
├── src/
│   ├── editor.ts ## CodeMirror setup
│   ├── preview/
│   │   ├── render.ts
│   │   └── zoom.ts
│   └── export.ts ## PNG / SVG writers
├── css/
│   └── styles.css ## design tokens
├── package.json ## no build step!
└── README.md`
    },
    {
        id: 'treemap',
        group: 'Structure & planning',
        label: 'Treemap',
        source: `treemap-beta
"Editor features"
    "Editing"
        "Tabs": 34
        "Templates": 36
        "Shortcuts": 12
    "Preview"
        "Zoom & pan": 20
        "Themes": 11
        "Layouts": 4
    "Export"
        "PNG": 9
        "SVG": 4`
    },
    {
        id: 'kanban',
        group: 'Structure & planning',
        label: 'Kanban Board',
        source: `kanban
  todo[Todo]
    task1[Write ELK docs]@{ priority: 'Low' }
    task2[Ship step animation]@{ ticket: MC-2037, assigned: 'knsv', priority: 'High' }
  doing[In progress]
    task3[Review use-case renderer]@{ assigned: 'Andrew WILLIAMS', priority: 'High' }
  done[Done]
    task4[Bundle elkjs]@{ priority: 'Medium' }`
    },
    {
        id: 'architecture',
        group: 'Structure & planning',
        label: 'Architecture Diagram',
        source: `architecture-beta
    group api(cloud)[Editor]
    group data(database)[Persistence]

    service editor(browser)[Editor] in api
    service preview(browser)[Preview] in api
    service store(localstorage)[Local storage] in data
    service files(filesystem)[Files] in data

    editor:L -- R:preview
    store:T -- B:editor
    files:T -- B:store`
    },
    {
        id: 'block',
        group: 'Structure & planning',
        label: 'Block Diagram',
        source: `block-beta
    columns 3
        editor["Editor"]
        space
        preview["Preview"]
        editor --> preview

        block:build["Build"]
            parse["Parse"]
            layout["Layout"]
            render["Render"]
            parse --> layout --> render
        end

        build --> preview
        db[("Local storage")]
        build --> db`
    },

    // ── Analysis & strategy ─────────────────────────────────────────────────
    {
        id: 'venn',
        group: 'Analysis & strategy',
        label: 'Venn Diagram',
        source: `venn-beta
    title What makes a good feature
    set Desirable
    set Feasible
    set Viable
    union Desirable,Feasible["Buildable"]
    union Feasible,Viable["Sustainable"]
    union Desirable,Viable["Marketable"]
    union Desirable,Feasible,Viable["Ship it"]`
    },
    {
        id: 'ishikawa',
        group: 'Analysis & strategy',
        label: 'Ishikawa / Fishbone',
        source: `ishikawa-beta
    Slow page load
    Frontend
        Large bundle
        Blocking render
        Unminified assets
    Network
        No CDN
        Slow API response
    Backend
        N+1 queries
        Cold cache
    Build
        Source maps shipped`
    },
    {
        id: 'wardley',
        group: 'Analysis & strategy',
        label: 'Wardley Map',
        source: `wardley-beta
title Online shop value chain

anchor Customer [0.95, 0.63]
component Shop [0.85, 0.61] (build)
component Checkout [0.72, 0.71] (build)
component Payments [0.66, 0.55] (buy)
component Identity [0.58, 0.42] (outsource)
component Compute [0.18, 0.72] (market)

Customer -> Shop
Shop -> Checkout
Checkout -> Payments
Checkout -> Identity
Payments -> Compute

evolve Compute 0.95
evolve Identity 0.80

note "Compute and identity are utilities" [0.34, 0.34]`
    },
    {
        id: 'cynefin',
        group: 'Analysis & strategy',
        label: 'Cynefin Framework',
        source: `cynefin-beta
    title Incident response

    complex
        "Investigate root cause"
        "Run chaos experiment"

    complicated
        "Analyse performance data"
        "Expert review needed"

    clear
        "Restart the service"
        "Apply known fix"

    chaotic
        "Page on-call immediately"

    confusion
        "Unknown failure mode"

    complex --> complicated : "Pattern identified"
    complicated --> clear : "Best practice codified"
    clear --> chaotic : "Complacency"
    chaotic --> complex : "Stabilised"`
    },
    {
        id: 'eventmodeling',
        group: 'Analysis & strategy',
        label: 'Event Modeling',
        source: `eventmodeling

tf 01 ui CartUI
tf 02 cmd AddItem [[AddItem01]]
tf 03 evt ItemAdded [[ItemAdded]]
tf 04 cmd Checkout [[Checkout01]]
tf 05 evt OrderPlaced [[OrderPlaced]]

data AddItem01 {
  description: 'espresso machine'
  price: 249.0
}

data ItemAdded {
  description: string
  price: number
}

data Checkout01 {
  description: 'card ···· 4242'
}

data OrderPlaced {
  description: string
  total: number
}`
    },

    // ── Railroad grammars ───────────────────────────────────────────────────
    {
        id: 'railroad-ebnf',
        group: 'Railroad grammars',
        label: 'Railroad — EBNF',
        source: `railroad-ebnf-beta
title "Arithmetic expression grammar"

expression = term ( ( "+" | "-" ) term )* ;
term = factor ( ( "*" | "/" ) factor )* ;
factor = number | "(" expression ")" ;
number = digit+ ;
digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;`
    },
    {
        id: 'railroad-abnf',
        group: 'Railroad grammars',
        label: 'Railroad — ABNF',
        source: `railroad-abnf-beta
title "Email address"

address = local-part "@" domain ;
local-part = 1*( ALPHA / DIGIT / "." / "-" ) ;
domain = label *( "." label ) ;
label = 1*( ALPHA / DIGIT / "-" ) ;`
    },
    {
        id: 'railroad-peg',
        group: 'Railroad grammars',
        label: 'Railroad — PEG',
        source: `railroad-peg-beta
title "Calculator grammar"

Expression <- Term (("+" / "-") Term)* ;
Term <- Factor (("*" / "/") Factor)* ;
Factor <- Number / "(" Expression ")" ;
Number <- Digit+ ;
Digit <- "0" / "1" / "2" / "3" / "4" / "5" / "6" / "7" / "8" / "9" ;`
    },
    {
        id: 'railroad-ir',
        group: 'Railroad grammars',
        label: 'Railroad — IR',
        source: `railroad-beta
title "Optional sign, then digits"

sign = choice(terminal("+"), terminal("-")) ;
number = sequence(optional(nonterminal("sign")), oneOrMore(nonterminal("digit"))) ;
digit = choice(terminal("0"), terminal("1"), terminal("2"), terminal("3"), terminal("4")) ;`
    },

    // ── Version control ─────────────────────────────────────────────────────
    {
        id: 'gitgraph',
        group: 'Version control',
        label: 'Git Graph',
        source: `gitGraph
    commit id: "Init"
    commit id: "Setup"
    branch feature/login
    checkout feature/login
    commit id: "Add login"
    commit id: "Add tests"
    checkout main
    merge feature/login id: "Merge login"
    commit id: "Release v1.0"`
    },
];

const DEFAULT_DIAGRAM = TEMPLATES[0].source;

            return { TEMPLATES, DEFAULT_DIAGRAM };
        })();

        const MermaidEditorExport = (() => {
            const {
                initializeMermaid,
                mermaid,
                getMermaidRenderHost,
            } = MermaidEditorMermaidApi;

/**
 * export.js — PNG / SVG export with embedded Mermaid source,
 *             and import/extraction from those files.
 *
 * PNG  → custom tEXt metadata chunk  (keyword "MermaidSource")
 * SVG  → data-mermaid-source attribute on root <svg> (base64-encoded)
 */

// ── CRC32 (required for PNG chunk integrity) ───────────────────────────────
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG tEXt chunk construction ────────────────────────────────────────────
function buildTextChunk(keyword, text) {
    const enc      = new TextEncoder();
    const kw       = enc.encode(keyword);
    const val      = enc.encode(text);
    const typeBytes = enc.encode('tEXt');

    // data = keyword + NUL + text
    const data = new Uint8Array(kw.length + 1 + val.length);
    data.set(kw, 0);
    data[kw.length] = 0; // NUL separator
    data.set(val, kw.length + 1);

    // CRC covers type + data
    const crcInput = new Uint8Array(typeBytes.length + data.length);
    crcInput.set(typeBytes, 0);
    crcInput.set(data, typeBytes.length);

    // Chunk layout: length(4) + type(4) + data(N) + crc(4)
    const chunk = new Uint8Array(12 + data.length);
    const dv    = new DataView(chunk.buffer);
    dv.setUint32(0, data.length, false); // big-endian length
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    dv.setUint32(8 + data.length, crc32(crcInput), false);
    return chunk;
}

/**
 * Inject a tEXt chunk into PNG bytes right after the IHDR chunk (offset 33).
 * @param {Uint8Array} pngBytes
 * @param {string} keyword
 * @param {string} text
 * @returns {Uint8Array}
 */
function injectTextChunk(pngBytes, keyword, text) {
    const chunk  = buildTextChunk(keyword, text);
    const result = new Uint8Array(pngBytes.length + chunk.length);
    result.set(pngBytes.slice(0, 33), 0);             // PNG sig + IHDR
    result.set(chunk, 33);                             // our tEXt chunk
    result.set(pngBytes.slice(33), 33 + chunk.length); // rest of original PNG
    return result;
}

/**
 * Walk PNG chunks and return a map of { keyword: value } for tEXt chunks.
 * @param {Uint8Array} bytes
 * @returns {{ [key: string]: string }}
 */
function extractTextChunksFromPNG(bytes) {
    const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
        if (bytes[i] !== PNG_SIG[i]) throw new Error('Not a valid PNG file');
    }
    const dec    = new TextDecoder('utf-8');
    const dv     = new DataView(bytes.buffer, bytes.byteOffset);
    const chunks = {};
    let   offset = 8;

    while (offset + 12 <= bytes.length) {
        const length = dv.getUint32(offset, false);
        const type   = dec.decode(bytes.slice(offset + 4, offset + 8));
        if (type === 'tEXt' && length > 0) {
            const raw     = bytes.slice(offset + 8, offset + 8 + length);
            const text    = dec.decode(raw);
            const nullIdx = text.indexOf('\0');
            if (nullIdx !== -1) {
                chunks[text.slice(0, nullIdx)] = text.slice(nullIdx + 1);
            }
        }
        if (type === 'IEND') break;
        offset += 12 + length;
    }
    return chunks;
}

// ── SVG source embedding / extraction ─────────────────────────────────────
function b64Encode(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64Decode(b64) {
    try { return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); }
    catch { return null; }
}

/**
 * Add data-mermaid-source attribute to the root <svg> element.
 * @param {string} svgString
 * @param {string} source  — Mermaid source to embed
 * @returns {string}
 */
function embedSourceInSVG(svgString, source) {
    const encoded = b64Encode(source);
    // Replace the first occurrence of the opening <svg ...> tag
    return svgString.replace(/(<svg\b[^>]*)>/, `$1 data-mermaid-source="${encoded}">`);
}

/**
 * Extract Mermaid source embedded via embedSourceInSVG.
 * @param {string} svgString
 * @returns {string|null}
 */
function extractSourceFromSVG(svgString) {
    const m = svgString.match(/data-mermaid-source="([^"]+)"/);
    return m ? b64Decode(m[1]) : null;
}

// ── SVG dimension helper ───────────────────────────────────────────────────
/**
 * Return {width, height} from an SVG string's attributes or viewBox.
 * @param {string} svgString
 * @returns {{ width: number, height: number }}
 */
function getSVGDimensions(svgString) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(svgString, 'image/svg+xml');
    const el     = doc.documentElement;
    const w      = el.getAttribute('width');
    const h      = el.getAttribute('height');
    // Only use explicit pixel values — ignore percentages
    if (w && h && !w.includes('%') && !h.includes('%') && !isNaN(parseFloat(w))) {
        return { width: parseFloat(w), height: parseFloat(h) };
    }
    const vb = el.getAttribute('viewBox');
    if (vb) {
        const p = vb.trim().split(/[\s,]+/);
        if (p.length >= 4) return { width: parseFloat(p[2]), height: parseFloat(p[3]) };
    }
    return { width: 800, height: 600 };
}

/**
 * Normalize an SVG string so browsers can decode it reliably as an image.
 * @param {string} svgString
 * @returns {string}
 */
function normalizeSVGForImage(svgString) {
    const match = svgString.match(/<svg\b[\s\S]*<\/svg>/i);
    if (!match) throw new Error('Invalid SVG document');

    let normalized = match[0];
    if (!/\sxmlns=/.test(normalized)) {
        normalized = normalized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    if (!/\sxmlns:xlink=/.test(normalized)) {
        normalized = normalized.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    }
    return normalized;
}

function svgToDataURL(svgString) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
}

/**
 * Render a Mermaid SVG intended for PNG export.
 * The live preview uses HTML labels, which taint canvas export in browsers.
 * For PNG export, re-render with plain SVG text labels instead.
 * @param {string} source
 * @param {string} theme
 * @returns {Promise<string>}
 */
async function renderExportSVG(source, theme = 'default') {
    const id = `mmd-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    initializeMermaid(theme, false, parseDiagramType(source));

    try {
        const { svg } = await mermaid.render(id, source, getMermaidRenderHost());
        return normalizeSVGForImage(svg);
    } finally {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
    }
}

// ── SVG → Canvas → PNG ────────────────────────────────────────────────────
/**
 * Rasterise an SVG string to a PNG ArrayBuffer at the given scale.
 * @param {string} svgString
 * @param {number} scale   pixel density multiplier (1 = natural size)
 * @returns {Promise<ArrayBuffer>}
 */
async function svgToPNGArrayBuffer(svgString, scale = 1) {
    return new Promise((resolve, reject) => {
        const { width, height } = getSVGDimensions(svgString);
        const cw   = Math.max(1, Math.round(width  * scale));
        const ch   = Math.max(1, Math.round(height * scale));

        // Set explicit pixel dimensions for reliable cross-browser canvas rendering
        const parser   = new DOMParser();
        const svgDoc   = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl    = svgDoc.documentElement;
        svgEl.setAttribute('width',  String(width));
        svgEl.setAttribute('height', String(height));
        const svgReady = normalizeSVGForImage(new XMLSerializer().serializeToString(svgDoc));
        const img  = new Image();
        let   blobUrl = null;

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            canvas.toBlob(b => {
                if (!b) { reject(new Error('Canvas toBlob returned null')); return; }
                b.arrayBuffer().then(resolve).catch(reject);
            }, 'image/png');
        };
        img.onerror = () => {
            if (!blobUrl) {
                const blob = new Blob([svgReady], { type: 'image/svg+xml;charset=utf-8' });
                blobUrl = URL.createObjectURL(blob);
                img.src = blobUrl;
                return;
            }
            URL.revokeObjectURL(blobUrl);
            reject(new Error('SVG image load failed'));
        };
        img.src = svgToDataURL(svgReady);
    });
}

// ── Download helper ────────────────────────────────────────────────────────
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ── Public export functions ────────────────────────────────────────────────

/**
 * Save the diagram as a PNG file with embedded Mermaid source.
 * @param {string} svgString  — rendered SVG from Mermaid
 * @param {string} source     — original Mermaid text
 * @param {string} filename   — e.g. "diagram.png"
 * @param {number} scale      — 1 = natural, 2 = retina, etc.
 */
async function savePNG(svgString, source, filename = 'diagram.png', scale = 1, theme = 'default') {
    const exportSVG   = await renderExportSVG(source, theme);
    const svgWithMeta = embedSourceInSVG(exportSVG, source);
    const pngBuf      = await svgToPNGArrayBuffer(svgWithMeta, scale);
    const pngU8       = new Uint8Array(pngBuf);
    const pngFinal    = injectTextChunk(pngU8, 'MermaidSource', source);
    downloadBlob(new Blob([pngFinal], { type: 'image/png' }), filename);
}

/**
 * Save the diagram as an SVG file with embedded Mermaid source.
 */
function saveSVG(svgString, source, filename = 'diagram.svg') {
    const svgWithMeta = embedSourceInSVG(svgString, source);
    downloadBlob(new Blob([svgWithMeta], { type: 'image/svg+xml' }), filename);
}

/**
 * Open the diagram as a PNG in a new browser tab.
 */
async function previewPNGInTab(svgString, source, scale = 1, theme = 'default') {
    const exportSVG   = await renderExportSVG(source, theme);
    const svgWithMeta = embedSourceInSVG(exportSVG, source);
    const pngBuf      = await svgToPNGArrayBuffer(svgWithMeta, scale);
    const pngU8       = new Uint8Array(pngBuf);
    const pngFinal    = injectTextChunk(pngU8, 'MermaidSource', source);
    const url = URL.createObjectURL(new Blob([pngFinal], { type: 'image/png' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/**
 * Open the diagram as an SVG in a new browser tab.
 */
function previewSVGInTab(svgString, source) {
    const svgWithMeta = embedSourceInSVG(svgString, source);
    const url = URL.createObjectURL(new Blob([svgWithMeta], { type: 'image/svg+xml' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ── Import from file ───────────────────────────────────────────────────────

/**
 * Read a PNG or SVG file and return the embedded Mermaid source, or null.
 * @param {File} file
 * @returns {Promise<string|null>}
 */
async function extractSourceFromFile(file) {
    const name = file.name.toLowerCase();

    if (name.endsWith('.svg') || file.type === 'image/svg+xml') {
        const text = await file.text();
        return extractSourceFromSVG(text);
    }

    if (name.endsWith('.png') || file.type === 'image/png') {
        try {
            const buf    = await file.arrayBuffer();
            const bytes  = new Uint8Array(buf);
            const chunks = extractTextChunksFromPNG(bytes);
            return chunks['MermaidSource'] ?? null;
        } catch {
            return null;
        }
    }

    // Plain text / .mmd files
    if (name.endsWith('.mmd') || name.endsWith('.md') || file.type.startsWith('text/')) {
        return await file.text();
    }

    return null;
}

            return {
                extractTextChunksFromPNG,
                embedSourceInSVG,
                extractSourceFromSVG,
                getSVGDimensions,
                savePNG,
                saveSVG,
                previewPNGInTab,
                previewSVGInTab,
                extractSourceFromFile,
            };
        })();

        const MermaidEditorPreview = (() => {
            const { getSVGDimensions } = MermaidEditorExport;
            const {
                initializeMermaid,
                mermaid,
                getMermaidRenderHost,
            } = MermaidEditorMermaidApi;

/**
 * preview.js — Mermaid diagram rendering, zoom/pan, and theme control.
 *
 * Imports:   getSVGDimensions from ./export.js
 *            initializeMermaid, mermaid from ./mermaid-api.js
 */
// ── Module-level state ─────────────────────────────────────────────────────
let previewArea    = null; // outer container (overflow:hidden)
let diagramWrapper = null; // inner div that receives CSS transform
let zoomDisplay    = null; // element showing zoom %

let _currentSVG   = '';
let _mermaidTheme = 'default';
let _renderSerial = 0;     // increments each render to avoid stale callbacks
let _hasAutoFit   = false; // auto-fit once on first successful render
let _transformChangeListener = null;

const transform = { scale: 1, tx: 0, ty: 0 };
let isPanning  = false;
let panStart   = { x: 0, y: 0 };

// ── Public accessors ───────────────────────────────────────────────────────
const getScale      = () => transform.scale;
const getCurrentSVG = () => _currentSVG;
const getMermaidTheme = () => _mermaidTheme;
const getCurrentTransform = () => ({ ...transform });

function setTransformChangeListener(listener) {
    _transformChangeListener = typeof listener === 'function' ? listener : null;
}

// ── Initialisation ─────────────────────────────────────────────────────────
/**
 * @param {HTMLElement} pArea        – the preview wrapper (overflow:hidden)
 * @param {HTMLElement} dWrapper     – the diagram inner div
 * @param {HTMLElement} zDisplay     – element showing the zoom percentage
 * @param {string}    [initialTheme] – persisted Mermaid theme to adopt
 */
function initPreview(pArea, dWrapper, zDisplay, initialTheme) {
    previewArea    = pArea;
    diagramWrapper = dWrapper;
    zoomDisplay    = zDisplay;

    diagramWrapper.style.transformOrigin = '0 0';
    diagramWrapper.style.position        = 'absolute';

    if (initialTheme) _mermaidTheme = initialTheme;

    mermaidInit(_mermaidTheme, '');

    // Mouse wheel zoom
    previewArea.addEventListener('wheel', onWheel, { passive: false });

    // Drag-to-pan
    previewArea.addEventListener('pointerdown', onPanStart);
    window.addEventListener('pointermove', onPanMove);
    window.addEventListener('pointerup',   onPanEnd);

    // Pinch-to-zoom (touch)
    previewArea.addEventListener('touchstart', onTouchStart, { passive: false });
    previewArea.addEventListener('touchmove',  onTouchMove,  { passive: false });
    previewArea.addEventListener('touchend',   () => { _lastPinchDist = null; });
}

/**
 * Re-initialise Mermaid for the current theme plus the diagram type being
 * rendered, so per-diagram layout fallbacks and theme defaults apply.
 */
function mermaidInit(theme, source) {
    initializeMermaid(theme, true, parseDiagramType(source));
}

// ── Rendering ──────────────────────────────────────────────────────────────
let _debounceTimer = null;
let _debounceResolve = null;

/**
 * Schedule a render after `delayMs` milliseconds (debounced).
 * Returns a Promise that resolves with { errorLine, errorMsg }.
 * Superseded renders resolve immediately with a no-op result instead of hanging.
 */
function scheduleRender(source, delayMs = 280) {
    clearTimeout(_debounceTimer);
    if (_debounceResolve) {
        _debounceResolve({ errorLine: null, errorMsg: null });
        _debounceResolve = null;
    }
    return new Promise(resolve => {
        _debounceResolve = resolve;
        _debounceTimer = setTimeout(async () => {
            _debounceResolve = null;
            resolve(await renderNow(source));
        }, delayMs);
    });
}

/**
 * Render the Mermaid source immediately.
 * @param {string} source
 * @returns {Promise<{ errorLine: number|null, errorMsg: string|null }>}
 */
async function renderNow(source, options = {}) {
    const { preserveTransform = false } = options;
    if (!source || !source.trim()) {
        _currentSVG = '';
        diagramWrapper.innerHTML =
            `<div class="diagram-hint">Start typing Mermaid syntax in the editor…</div>`;
        _hasAutoFit = false;
        updateZoomDisplay();
        return { errorLine: null, errorMsg: null };
    }

    const serial = ++_renderSerial;
    const id     = `mmd-${serial}`;

    try {
        mermaidInit(_mermaidTheme, source); // apply current theme before each render
        const { svg, bindFunctions } = await mermaid.render(id, source, getMermaidRenderHost());

        // Clean up any DOM artefacts Mermaid may have left behind
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();

        // Ignore stale renders if a newer one fired
        if (serial !== _renderSerial) return { errorLine: null, errorMsg: null };

        _currentSVG = svg;
        diagramWrapper.innerHTML = svg;
        bindFunctions?.(diagramWrapper);

        // Pin the SVG to its natural pixel dimensions so CSS transforms
        // on diagramWrapper correctly represent the zoom level.
        // (Mermaid outputs max-width:Npx with no explicit width attr;
        //  without pinning, the SVG inflates to fill the container and
        //  all zoom arithmetic becomes incorrect.)
        const svgEl = diagramWrapper.querySelector('svg');
        if (svgEl) {
            const { width: naturalW, height: naturalH } = getSVGDimensions(_currentSVG);
            if (naturalW > 0) svgEl.style.width  = naturalW  + 'px';
            if (naturalH > 0) svgEl.style.height = naturalH + 'px';
            svgEl.style.display  = 'block';
            svgEl.style.overflow = 'visible';
        }

        if (!_hasAutoFit && !preserveTransform) {
            fitToScreen();
            _hasAutoFit = true;
        } else if (preserveTransform) {
            applyTransform();
        }

        updateZoomDisplay();
        return { errorLine: null, errorMsg: null };

    } catch (err) {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();

        if (serial !== _renderSerial) return { errorLine: null, errorMsg: null };

        _currentSVG = '';
        const msg = err?.message ?? String(err);

        diagramWrapper.innerHTML =
            `<div class="render-error">
                <div class="render-error-title">⚠ Parse error</div>
                <pre class="render-error-pre">${escapeHtml(msg)}</pre>
            </div>`;

        return { errorLine: parseErrorLine(msg), errorMsg: msg };
    }
}

function parseErrorLine(msg) {
    const m = msg.match(/line[:\s]+(\d+)/i) || msg.match(/at line (\d+)/i);
    return m ? parseInt(m[1], 10) - 1 : null; // 0-indexed for CodeMirror
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Mermaid theme ──────────────────────────────────────────────────────────
async function setMermaidTheme(theme, source) {
    _mermaidTheme = theme;
    return renderNow(source, { preserveTransform: true });
}

async function rerenderPreview(source) {
    _hasAutoFit = false;
    return renderNow(source);
}

// ── Transform helpers ──────────────────────────────────────────────────────
function applyTransform() {
    diagramWrapper.style.transform =
        `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`;
    updateZoomDisplay();
    _transformChangeListener?.(getCurrentTransform());
}

function updateZoomDisplay() {
    if (zoomDisplay) {
        zoomDisplay.textContent = `${Math.round(transform.scale * 100)}%`;
    }
}

function clampScale(s) { return Math.min(20, Math.max(0.04, s)); }

function restoreTransform(nextTransform) {
    if (!nextTransform || typeof nextTransform !== 'object') return;
    const scale = Number(nextTransform.scale);
    const tx = Number(nextTransform.tx);
    const ty = Number(nextTransform.ty);
    if (!Number.isFinite(scale) || !Number.isFinite(tx) || !Number.isFinite(ty)) return;
    transform.scale = clampScale(scale);
    transform.tx = tx;
    transform.ty = ty;
    applyTransform();
}

// ── Public zoom controls ───────────────────────────────────────────────────
/**
 * Set zoom level, optionally anchored to a point in the preview area.
 * @param {number} newScale
 * @param {number} [ox]  – origin X in preview-area local coords
 * @param {number} [oy]  – origin Y in preview-area local coords
 */
function setZoom(newScale, ox, oy) {
    const s  = clampScale(newScale);
    const rect = previewArea.getBoundingClientRect();
    const cx = ox ?? rect.width  / 2;
    const cy = oy ?? rect.height / 2;
    const r  = s / transform.scale;
    transform.tx    = cx + r * (transform.tx - cx);
    transform.ty    = cy + r * (transform.ty - cy);
    transform.scale = s;
    applyTransform();
    return s;
}

function zoomIn()  { return setZoom(transform.scale * 1.2); }
function zoomOut() { return setZoom(transform.scale / 1.2); }

function setZoomToValue(pct) {
    return setZoom(pct / 100);
}

function resetZoom() {
    const rect = previewArea.getBoundingClientRect();
    transform.scale = 1;
    transform.tx    = rect.width  / 2;
    transform.ty    = rect.height / 2;
    // Actually centre the SVG
    const svgEl = diagramWrapper.querySelector('svg');
    if (svgEl) {
        const { width: sw, height: sh } = getSVGDimensions(_currentSVG || svgEl.outerHTML);
        transform.tx = (rect.width  - sw) / 2;
        transform.ty = (rect.height - sh) / 2;
    }
    applyTransform();
    return 1;
}

function fitToScreen() {
    if (!previewArea || !diagramWrapper) return;
    const svgEl = diagramWrapper.querySelector('svg');
    if (!svgEl && !_currentSVG) return;

    // Use the SVG element's CSS layout dimensions (offsetWidth/offsetHeight),
    // which are unaffected by CSS transforms and reflect the pinned natural
    // pixel size we set during render.  Fall back to string-parsed dimensions
    // if the element isn't in the live DOM for some reason.
    const svgW = (svgEl && svgEl.offsetWidth)  || getSVGDimensions(_currentSVG).width;
    const svgH = (svgEl && svgEl.offsetHeight) || getSVGDimensions(_currentSVG).height;
    if (!svgW || !svgH) return;

    const containerW = previewArea.clientWidth;
    const containerH = previewArea.clientHeight;
    if (containerW <= 0 || containerH <= 0) return;

    const pad = 40;

    const s = Math.min(
        (containerW - pad * 2) / svgW,
        (containerH - pad * 2) / svgH,
        2 // never zoom in beyond 200% on fit
    );

    transform.scale = clampScale(s);
    transform.tx    = (containerW - svgW  * transform.scale) / 2;
    transform.ty    = (containerH - svgH  * transform.scale) / 2;
    applyTransform();
    return transform.scale;
}

// ── Mouse wheel ────────────────────────────────────────────────────────────
function onWheel(e) {
    e.preventDefault();
    const rect   = previewArea.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const mx     = e.clientX - rect.left;
    const my     = e.clientY - rect.top;
    setZoom(transform.scale * factor, mx, my);
}

// ── Drag to pan ────────────────────────────────────────────────────────────
function onPanStart(e) {
    if (e.button !== 0) return;
    isPanning = true;
    panStart  = { x: e.clientX - transform.tx, y: e.clientY - transform.ty };
    previewArea.style.cursor = 'grabbing';
    previewArea.setPointerCapture(e.pointerId);
}

function onPanMove(e) {
    if (!isPanning) return;
    transform.tx = e.clientX - panStart.x;
    transform.ty = e.clientY - panStart.y;
    applyTransform();
}

function onPanEnd() {
    if (!isPanning) return;
    isPanning = false;
    if (previewArea) previewArea.style.cursor = 'grab';
}

// ── Pinch to zoom ──────────────────────────────────────────────────────────
let _lastPinchDist = null;

function pinchDist(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function onTouchStart(e) {
    if (e.touches.length === 2) { e.preventDefault(); _lastPinchDist = pinchDist(e.touches); }
}

function onTouchMove(e) {
    if (e.touches.length !== 2 || !_lastPinchDist) return;
    e.preventDefault();
    const dist  = pinchDist(e.touches);
    const ratio = dist / _lastPinchDist;
    const cx    = (e.touches[0].clientX + e.touches[1].clientX) / 2
                  - previewArea.getBoundingClientRect().left;
    const cy    = (e.touches[0].clientY + e.touches[1].clientY) / 2
                  - previewArea.getBoundingClientRect().top;
    setZoom(transform.scale * ratio, cx, cy);
    _lastPinchDist = dist;
}

            return {
                initPreview,
                scheduleRender,
                renderNow,
                zoomIn,
                zoomOut,
                fitToScreen,
                resetZoom,
                setZoom,
                setZoomToValue,
                setMermaidTheme,
                getScale,
                getCurrentSVG,
                getMermaidTheme,
                rerenderPreview,
                getCurrentTransform,
                restoreTransform,
                setTransformChangeListener,
            };
        })();

        const MermaidEditorEditor = (() => {
/**
 * editor.js — CodeMirror 5 editor setup with a custom Mermaid syntax mode
 *             and error-line highlighting.
 *
 * Requires: window.CodeMirror loaded before this module.
 */

// ── Mermaid syntax mode definition ────────────────────────────────────────
(function defineMermaidMode(CM) {
    const DIAGRAM_TYPES = new Set([
        'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
        'stateDiagram', 'gantt', 'pie', 'gitGraph', 'erDiagram',
        'journey', 'mindmap', 'timeline', 'quadrantChart',
        'requirementDiagram', 'C4Context', 'C4Container',
        'C4Component', 'C4Dynamic', 'C4Deployment', 'block',
        'xychart', 'packet', 'architecture', 'radar', 'treemap',
        'kanban', 'venn', 'ishikawa', 'sankey', 'wardley',
        'eventmodeling', 'cynefin', 'swimlane', 'usecase',
        'agentflow', 'treeView', 'railroad',
        // Explicit *-beta names (also matched by DIAGRAM_RE)
        'stateDiagram-v2', 'xychart-beta', 'block-beta', 'packet-beta',
        'architecture-beta', 'radar-beta', 'treemap-beta', 'venn-beta',
        'ishikawa-beta', 'wardley-beta', 'cynefin-beta', 'swimlane-beta',
        'usecase-beta', 'agentflow-beta', 'treeView-beta', 'railroad-beta',
        'railroad-ebnf-beta', 'railroad-abnf-beta', 'railroad-peg-beta',
    ]);

    // Matches diagram type names that include a hyphen (e.g. stateDiagram-v2,
    // treeView-beta, railroad-peg-beta)
    const DIAGRAM_RE = /^(stateDiagram-v2|[a-zA-Z][a-zA-Z]*-beta)\b/;

    const KEYWORDS = new Set([
        'subgraph', 'end', 'note', 'loop', 'alt', 'else', 'opt', 'par',
        'and', 'rect', 'classDef', 'class', 'linkStyle', 'style', 'direction',
        'participant', 'actor', 'activate', 'deactivate', 'autonumber',
        'title', 'section', 'LR', 'RL', 'TB', 'BT', 'TD',
        'click', 'href', 'link', 'namespace', 'over', 'as',
        'dateFormat', 'axisFormat', 'tickInterval', 'excludes', 'includes',
        'accTitle', 'accDescr', 'left', 'right', 'of',
        // ── Extended-syntax keywords ────────────────────────────────────
        // use case / swimlane / agentflow
        'systemBoundary', 'system', 'boundary', 'flow', 'include', 'extend',
        'generalizes', 'contract',
        // wardley / cynefin / event modeling
        'anchor', 'component', 'evolve', 'dependency', 'capability',
        'support', 'infrastructure', 'goal', 'platform', 'technique',
        'repeat', 'review', 'data', 'channels', 'channel', 'event', 'source',
        'dataset', 'past', 'future',
        // venn / treemap / kanban / radar / sankey
        'union', 'set', 'graticule', 'ticks', 'curve', 'axis', 'x-axis', 'y-axis',
        'bar', 'line', 'max', 'min', 'legend', 'priority', 'ticket', 'assigned',
        // flowchart inline directives (@{ … }) and built-in shapes
        'shape', 'marker', 'type', 'view', 'collapsed', 'expanded', 'step',
        'stepNumbers', 'stepDuration', 'person', 'folder', 'bucket', 'console',
        'browser',
        // packet / mindmap / xyChart options
        'bitOrder', 'ascending', 'descending', 'colorBy', 'depth',
        'showLegend', 'showDataLabel',
        // requirement diagram
        'requirement', 'functionalRequirement', 'interfaceRequirement',
        'performanceRequirement', 'physicalRequirement', 'designRequirement',
        'acceptanceRequirement', 'wideRequirement', 'element', 'contains',
        'satisfy', 'verify', 'derive', 'trace', 'copy', 'cite', 'realize',
        'validate', 'risk', 'verifymethod',
        // state / class diagram v2
        'state', 'partition', 'hide', 'empty', 'choice', 'fork', 'join',
        'history', 'retry', 'timeout', 'entry', 'exit', 'stop', 'kill', 'detach',
        'interface', 'enum', 'abstract', 'package', 'annotation', 'struct',
        // sequence diagram
        'box', 'create', 'destroy', 'links', 'critical', 'break', 'return',
    ]);

    CM.defineMode('mermaid', function () {
        return {
            startState() {
                return {
                    inBracket:    null,  // expected closing string while inside a node label
                    inString:     null,  // expected closing quote char
                    isLineStart:  true,
                };
            },

            token(stream, state) {
                if (stream.sol()) state.isLineStart = true;
                if (stream.eatSpace()) return null;

                // ── Inside a node-label bracket ──────────────────────────
                if (state.inBracket) {
                    if (stream.match(state.inBracket)) {
                        state.inBracket = null;
                        return 'bracket';
                    }
                    // Allow quoted sub-strings inside labels
                    if (state.inString) {
                        if (stream.eat(state.inString)) { state.inString = null; return 'string'; }
                        stream.next();
                        return 'string';
                    }
                    const qc = stream.peek();
                    if (qc === '"' || qc === "'") {
                        state.inString = stream.next();
                        return 'string';
                    }
                    stream.next();
                    return 'string';
                }

                // ── Line comment ─────────────────────────────────────────
                if (stream.match('%%')) {
                    stream.skipToEnd();
                    return 'comment';
                }

                // ── Quoted strings ───────────────────────────────────────
                const qc = stream.peek();
                if (qc === '"' || qc === "'") {
                    state.inString = stream.next();
                    while (!stream.eol()) {
                        if (stream.eat(state.inString)) { state.inString = null; break; }
                        stream.next();
                    }
                    state.inString = null;
                    return 'string';
                }

                // ── Double-char bracket openers (check before single) ────
                if (stream.match('[['))  { state.inBracket = ']]';  state.isLineStart = false; return 'bracket'; }
                if (stream.match('[/'))  { state.inBracket = '/]';  state.isLineStart = false; return 'bracket'; }
                if (stream.match('[\\')) { state.inBracket = '\\]'; state.isLineStart = false; return 'bracket'; }
                if (stream.match('[('))  { state.inBracket = ')]';  state.isLineStart = false; return 'bracket'; }
                if (stream.match('(('))  { state.inBracket = '))';  state.isLineStart = false; return 'bracket'; }
                if (stream.match('{{'))  { state.inBracket = '}}';  state.isLineStart = false; return 'bracket'; }

                // ── Single-char bracket openers ──────────────────────────
                {
                    const c = stream.peek();
                    if (c === '[') { stream.next(); state.inBracket = ']';  state.isLineStart = false; return 'bracket'; }
                    if (c === '(') { stream.next(); state.inBracket = ')';  state.isLineStart = false; return 'bracket'; }
                    if (c === '{') { stream.next(); state.inBracket = '}';  state.isLineStart = false; return 'bracket'; }
                }

                // ── Arrow / edge syntax ─────────────────────────────────
                if (stream.match(/^(-{1,3}>{1,2}|={2,3}>?|-{1,3}o\b|-{1,3}x\b|<-{2,3}>?|o-{2,3}|x-{2,3}|-{2,3}|-\.->|-\.\.|\.{3}|~{2,3})/)) {
                    state.isLineStart = false;
                    return 'operator';
                }

                // ── Class / relation connectors ──────────────────────────
                if (stream.match(/^(\|>{1,2}|<\|{1,2}|\*--|--\*|o--|--o|\.\.|<\.\.|\.\.>|:)/)) {
                    state.isLineStart = false;
                    return 'operator';
                }

                // ── Hex color ───────────────────────────────────────────
                if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) {
                    state.isLineStart = false;
                    return 'atom';
                }

                // ── Numbers ──────────────────────────────────────────────
                if (stream.match(/^\d+(?:\.\d+)?[dwms]?\b/)) {
                    state.isLineStart = false;
                    return 'number';
                }

                // ── Identifiers  →  diagram types / keywords / variables ─
                if (stream.match(/^[\w-]+/)) {
                    const word = stream.current();
                    state.isLineStart = false;

                    // Hyphenated diagram type variants
                    if (DIAGRAM_RE.test(word)) return 'def keyword';

                    // Plain diagram type (first token on a line or known keyword)
                    if (DIAGRAM_TYPES.has(word)) return 'def keyword';

                    if (KEYWORDS.has(word)) return 'keyword';

                    return 'variable';
                }

                stream.next();
                state.isLineStart = false;
                return null;
            },

            lineComment: '%%',
        };
    });

    CM.defineMIME('text/x-mermaid', 'mermaid');
}(window.CodeMirror));

// ── Auto-complete hint list ────────────────────────────────────────────────
const HINT_WORDS = [
    // Diagram types
    'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2',
    'gantt', 'pie', 'gitGraph', 'erDiagram', 'journey', 'mindmap', 'timeline',
    'quadrantChart', 'xychart-beta', 'block-beta', 'requirementDiagram',
    'packet-beta', 'architecture-beta', 'radar-beta', 'treemap-beta', 'kanban',
    'venn-beta', 'ishikawa-beta', 'sankey-beta', 'wardley-beta', 'eventmodeling',
    'cynefin-beta', 'swimlane-beta', 'usecase-beta', 'agentflow-beta',
    'treeView-beta', 'railroad-beta', 'railroad-ebnf-beta', 'railroad-abnf-beta',
    'railroad-peg-beta',
    // Keywords
    'subgraph', 'end', 'note', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect',
    'classDef', 'class', 'linkStyle', 'style', 'direction', 'participant', 'actor',
    'activate', 'deactivate', 'autonumber', 'title', 'section',
    'LR', 'RL', 'TB', 'BT', 'TD',
    'dateFormat', 'axisFormat', 'tickInterval', 'excludes', 'includes',
    'accTitle', 'accDescr', 'click', 'href', 'link', 'namespace',
    // New-syntax helpers
    'systemBoundary', 'flow', 'shape', 'marker', 'view', 'collapsed', 'step',
    'evolve', 'anchor', 'component', 'system', 'data', 'union', 'set',
    'bitOrder', 'colorBy', 'showLegend', 'showDataLabel', 'stepNumbers',
    'graticule', 'ticks', 'curve', 'axis', 'x-axis', 'y-axis', 'bar', 'line',
];

function mermaidHint(cm) {
    const cur = cm.getCursor();
    const tok = cm.getTokenAt(cur);
    const word = tok.string.trim();
    const list = word
        ? HINT_WORDS.filter(w => w.toLowerCase().startsWith(word.toLowerCase()))
        : HINT_WORDS;
    return {
        list,
        from: window.CodeMirror.Pos(cur.line, tok.start),
        to:   window.CodeMirror.Pos(cur.line, tok.end),
    };
}

// ── Editor initialisation ─────────────────────────────────────────────────
let _editor       = null;
let _errorMarks   = [];  // active TextMarker objects
let _errorLineHandle = null;

/**
 * Create and return a CodeMirror instance attached to `textareaEl`.
 * @param {HTMLTextAreaElement} textareaEl
 * @param {string} initialValue
 * @returns {CodeMirror.Editor}
 */
function initEditor(textareaEl, initialValue = '') {
    const CM = window.CodeMirror;

    _editor = CM.fromTextArea(textareaEl, {
        mode:            'mermaid',
        theme:           'default',
        lineNumbers:     true,
        lineWrapping:    false,
        dragDrop:        false,
        matchBrackets:   true,
        autoCloseBrackets: true,
        indentUnit:      4,
        tabSize:         4,
        indentWithTabs:  false,
        extraKeys: {
            'Ctrl-Space': cm => CM.showHint(cm, mermaidHint),
            'Tab': cm => {
                if (cm.somethingSelected()) { cm.indentSelection('add'); }
                else { cm.replaceSelection('    ', 'end'); }
            },
        },
        placeholder: 'Start typing Mermaid diagram syntax here…\n\nExample:\n  flowchart LR\n      A --> B',
    });

    _editor.setValue(initialValue);
    _editor.clearHistory();

    return _editor;
}

// ── Theme switching ────────────────────────────────────────────────────────
function setEditorTheme(isDark) {
    _editor?.setOption('theme', isDark ? 'dracula' : 'default');
}

// ── Line-wrap toggle ───────────────────────────────────────────────────────
function toggleLineWrap() {
    const cur = _editor?.getOption('lineWrapping');
    _editor?.setOption('lineWrapping', !cur);
    return !cur;
}

// ── Error highlighting ─────────────────────────────────────────────────────
/**
 * Mark `lineIndex` (0-based) with an error background.
 * Pass null to clear all error marks.
 * @param {number|null} lineIndex
 */
function highlightErrorLine(lineIndex) {
    clearErrorHighlight();
    if (lineIndex === null || !_editor) return;

    const lineCount = _editor.lineCount();
    const safeIdx   = Math.min(lineIndex, lineCount - 1);

    _errorLineHandle = _editor.addLineClass(safeIdx, 'background', 'cm-error-line');

    // Also mark the full line text
    const lineInfo = _editor.getLine(safeIdx);
    if (lineInfo !== null) {
        const mark = _editor.markText(
            { line: safeIdx, ch: 0 },
            { line: safeIdx, ch: lineInfo.length },
            { className: 'cm-error-text' }
        );
        _errorMarks.push(mark);
    }

    // Scroll to error
    _editor.scrollIntoView({ line: safeIdx, ch: 0 }, 80);
}

function clearErrorHighlight() {
    _errorMarks.forEach(m => m.clear());
    _errorMarks = [];
    if (_editor && _errorLineHandle !== null) {
        try { _editor.removeLineClass(_errorLineHandle, 'background', 'cm-error-line'); }
        catch { /* ignore */ }
        _errorLineHandle = null;
    }
}

// ── Cursor position ────────────────────────────────────────────────────────
function getCursorPos() {
    if (!_editor) return { line: 1, ch: 1 };
    const c = _editor.getCursor();
    return { line: c.line + 1, ch: c.ch + 1 };
}

// ── Source helpers ─────────────────────────────────────────────────────────
function getSource()         { return _editor?.getValue()  ?? ''; }
function setSource(src)      { _editor?.setValue(src ?? ''); }
function focusEditor()       { _editor?.focus(); }

/**
 * Copy the current source to the clipboard.
 * @returns {Promise<boolean>}
 */
async function copySource() {
    try {
        await navigator.clipboard.writeText(getSource());
        return true;
    } catch {
        return false;
    }
}

/**
 * Detect the diagram type from the first non-comment, non-empty line.
 * @returns {string}
 */
function detectDiagramType() {
    if (!_editor) return 'unknown';
    return parseDiagramType(_editor.getValue());
}

            return {
                initEditor,
                setEditorTheme,
                setSource,
                getSource,
                focusEditor,
                highlightErrorLine,
                clearErrorHighlight,
                getCursorPos,
                detectDiagramType,
                toggleLineWrap,
                copySource,
            };
        })();

        (() => {
            const { TEMPLATES, DEFAULT_DIAGRAM } = MermaidEditorTemplates;
            const {
                savePNG, saveSVG, previewPNGInTab, previewSVGInTab,
                extractSourceFromFile, getSVGDimensions,
            } = MermaidEditorExport;
            const {
                initPreview, scheduleRender, renderNow,
                zoomIn, zoomOut, fitToScreen, resetZoom, setZoom, setZoomToValue,
                setMermaidTheme, getScale, getCurrentSVG, getMermaidTheme, rerenderPreview,
                getCurrentTransform, restoreTransform, setTransformChangeListener,
            } = MermaidEditorPreview;
            const {
                initEditor, setEditorTheme, setSource, getSource, focusEditor,
                highlightErrorLine, clearErrorHighlight, getCursorPos,
                detectDiagramType, toggleLineWrap, copySource,
            } = MermaidEditorEditor;
            const {
                setMermaidLayoutOptions, getMermaidLayoutOptions, getDefaultMermaidLayoutOptions,
                normalizeLayoutOptions, isValidMermaidTheme, isLayoutSupported,
                getEffectiveLayout, MERMAID_VERSION,
            } = MermaidEditorMermaidApi;

/**
 * app.js — Mermaid Diagram Editor · main entry point.
 *
 * Coordinates the editor (CodeMirror), the preview (Mermaid), export/import,
 * theme toggling, pane splitter, drag-and-drop, and localStorage persistence.
 */

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const editorPane    = $('editor-pane');
const previewArea   = $('preview-area');
const diagramWrap   = $('diagram-wrapper');
const zoomDisplay   = $('zoom-display');
const statusLine       = $('status-line');
const statusType       = $('status-type');
const statusLibVersion = $('status-lib-version');
let   layoutControlsReady = false;   // guards option sync until the controls are wired
const statusError      = $('status-error');
const statusErrorPopup = $('status-error-popup');
const statusErrorText  = $('status-error-popup-text');
const statusErrorGoto  = $('status-error-goto');
const editorTA      = $('editor-textarea');
const tabsHost          = $('editor-tabs');
const btnTabsScrollLeft  = $('btn-tabs-scroll-left');
const btnTabsScrollRight = $('btn-tabs-scroll-right');

// ── Storage keys ───────────────────────────────────────────────────────────
const LS_TABS        = 'mermaid-editor-tabs';
const LS_THEME_APP   = 'mermaid-editor-theme-app';   // 'light' | 'dark'
const LS_THEME_MMD   = 'mermaid-editor-theme-mmd';   // mermaid theme name
const LS_PANE_WIDTH  = 'mermaid-editor-pane-width';
const LS_LAYOUT_OPTS = 'mermaid-editor-layout-options';
// Bump when the stored shape changes; entries from another schema version are
// replaced by the current defaults instead of being half-migrated.
const LS_LAYOUT_OPTS_SCHEMA = 2;
const LS_AUTO_RENDER = 'mermaid-editor-auto-render';

// ── Bootstrap ──────────────────────────────────────────────────────────────
let isDark        = localStorage.getItem(LS_THEME_APP) === 'dark';
const storedTheme = localStorage.getItem(LS_THEME_MMD);
let mermaidTheme  = isValidMermaidTheme(storedTheme) ? storedTheme : 'default';
let layoutOptions = loadLayoutOptions();
let autoRender    = localStorage.getItem(LS_AUTO_RENDER) !== 'false';
let openTabs      = loadTabs();
let activeTabId   = openTabs[0]?.id ?? null;
let isSwitchingTabs = false;
let renamingTabId = null;
// Source last installed by the app itself (template insert, tab create/switch,
// import). Used to tell "untouched" diagrams apart from hand-edited ones, so
// replacement prompts only fire when there is actually something to lose.
let pristineSource = '';

// Apply active tab's per-tab settings, which take priority over global defaults
const _initActiveTab = openTabs.find(t => t.id === activeTabId) ?? openTabs[0];
if (_initActiveTab?.mermaidTheme) mermaidTheme = _initActiveTab.mermaidTheme;
if (_initActiveTab?.layoutOptions) layoutOptions = { ..._initActiveTab.layoutOptions };
setMermaidLayoutOptions(layoutOptions);

// Show which Mermaid build is powering the preview
if (statusLibVersion) {
    statusLibVersion.textContent = `mermaid ${MERMAID_VERSION}`;
    statusLibVersion.title       = `Mermaid ${MERMAID_VERSION} is loaded from the CDN and used to render diagrams`;
}

// Apply persisted dark mode before first paint
if (isDark) document.body.classList.add('dark');

// Restore persisted pane split
const savedPaneW = localStorage.getItem(LS_PANE_WIDTH);
if (savedPaneW) {
    editorPane.style.width = savedPaneW;
    editorPane.style.flex  = 'none';
}

// Load persisted (or default) source
const initialTab = getActiveTab();
const initialSource = initialTab?.source || DEFAULT_DIAGRAM;

// Init CodeMirror editor
const cmEditor = initEditor(editorTA, initialSource);
pristineSource = initialSource;
setEditorTheme(isDark);

// Init preview pane
initPreview(previewArea, diagramWrap, zoomDisplay, mermaidTheme);
setTransformChangeListener(transform => {
    updateActiveTabPreview(transform);
    if (saveDropdown?.classList.contains('show')) updateSaveDropdownLabel();
});

// Initial render
(async () => {
    const { errorLine, errorMsg } = await renderNow(getSource());
    if (initialTab?.preview) restoreTransform(initialTab.preview);
    else updateActiveTabPreview(getCurrentTransform());
    handleRenderResult(errorLine, errorMsg);
})();

// ── Editor → preview pipeline ──────────────────────────────────────────────
cmEditor.on('change', async () => {
    if (isSwitchingTabs) return;
    const src = getSource();
    updateActiveTabSource(src);
    updateStatusBar();
    if (!autoRender) {
        clearStatusError();
        clearErrorHighlight();
        return;
    }
    const { errorLine, errorMsg } = await scheduleRender(src);
    handleRenderResult(errorLine, errorMsg);
});

cmEditor.on('cursorActivity', updateStatusBar);

function handleRenderResult(errorLine, errorMsg) {
    clearErrorHighlight();
    if (errorMsg !== null) {
        if (errorLine !== null) highlightErrorLine(errorLine);
        showStatusError(errorMsg, errorLine);
    } else {
        clearStatusError();
    }
    updateStatusBar();
}

let _sourcePersistTimer = null;
function persistSource(src) {
    clearTimeout(_sourcePersistTimer);
    _sourcePersistTimer = setTimeout(() => persistTabs(), 400);
}

// ── Status bar ─────────────────────────────────────────────────────────────
function updateStatusBar() {
    const { line, ch } = getCursorPos();
    statusLine.textContent = `Ln ${line}, Col ${ch}`;
    const activeTab = getActiveTab();
    const detectedType = detectDiagramType();
    statusType.textContent = detectedType;
    if (activeTab && activeTab.type !== detectedType) {
        activeTab.type = detectedType;
        persistTabs();
        renderTabs();
    }
    if (layoutControlsReady) updateLayoutControlsState();
}

let _currentErrorLine = null;

function showStatusError(msg, errorLine) {
    _currentErrorLine = errorLine ?? null;
    const firstLine = msg?.split('\n')[0] ?? 'Error';
    statusError.textContent = '✕ ' + firstLine;
    statusError.hidden = false;
    statusError.setAttribute('aria-expanded', 'false');
    // Populate the popup but keep it closed
    statusErrorText.textContent = msg ?? 'Error';
    if (_currentErrorLine !== null) {
        statusErrorGoto.textContent = `↑ Go to line ${_currentErrorLine + 1}`;
        statusErrorGoto.hidden = false;
    } else {
        statusErrorGoto.hidden = true;
    }
    // Close popup if it was open for a previous error
    statusErrorPopup.hidden = true;
    statusError.setAttribute('aria-expanded', 'false');
}

function clearStatusError() {
    _currentErrorLine = null;
    statusError.textContent = '';
    statusError.hidden = true;
    statusError.setAttribute('aria-expanded', 'false');
    statusErrorPopup.hidden = true;
}

// Toggle popup on click
statusError.addEventListener('click', () => {
    const open = !statusErrorPopup.hidden;
    statusErrorPopup.hidden = open;
    statusError.setAttribute('aria-expanded', String(!open));
});

// Close popup when clicking outside
document.addEventListener('click', e => {
    if (!statusErrorPopup.hidden &&
        !statusErrorPopup.contains(e.target) &&
        e.target !== statusError) {
        statusErrorPopup.hidden = true;
        statusError.setAttribute('aria-expanded', 'false');
    }
});

// Go-to-line button
statusErrorGoto.addEventListener('click', () => {
    if (_currentErrorLine !== null) {
        cmEditor.setCursor({ line: _currentErrorLine, ch: 0 });
        cmEditor.scrollIntoView({ line: _currentErrorLine, ch: 0 }, 80);
        cmEditor.focus();
        statusErrorPopup.hidden = true;
        statusError.setAttribute('aria-expanded', 'false');
    }
});

// ── Theme toggle ───────────────────────────────────────────────────────────
$('theme-toggle').addEventListener('click', () => {
    isDark = !isDark;
    document.body.classList.toggle('dark', isDark);
    setEditorTheme(isDark);
    localStorage.setItem(LS_THEME_APP, isDark ? 'dark' : 'light');
    updateThemeToggleIcon();
});

function updateThemeToggleIcon() {
    $('theme-icon-moon').classList.toggle('hidden', isDark);
    $('theme-icon-sun').classList.toggle('hidden', !isDark);
}
updateThemeToggleIcon();

// ── Mermaid theme selector ─────────────────────────────────────────────────
const mmdThemeSelect = $('mermaid-theme');
mmdThemeSelect.value = mermaidTheme;
mmdThemeSelect.addEventListener('change', async () => {
    mermaidTheme = mmdThemeSelect.value;
    localStorage.setItem(LS_THEME_MMD, mermaidTheme);
    const activeTab = getActiveTab();
    if (activeTab) { activeTab.mermaidTheme = mermaidTheme; persistTabs(); }
    const { errorLine, errorMsg } = await setMermaidTheme(mermaidTheme, getSource());
    handleRenderResult(errorLine, errorMsg);
});

const layoutSelect      = $('layout-select');
const lookSelect        = $('look-select');
const inheritDirInput   = $('layout-inherit-dir');
const elkPlacementInput = $('elk-node-placement');
const elkMergeEdges     = $('elk-merge-edges');
const elkFeedbackInput  = $('elk-orient-feedback-edges');
const elkEntryInput     = $('elk-keep-entry-node-on-top');
const elkStraightenInput = $('elk-straighten-edges');
const elkLineHopsInput  = $('elk-line-hops');
const stepNumbersInput  = $('opt-step-numbers');
const stepDurationInput = $('opt-step-duration');
const stepDurationLabel = $('opt-step-duration-value');
const mindmapColorInput = $('opt-mindmap-color-by');
const packetBitInput    = $('opt-packet-bit-order');
const xyLegendInput     = $('opt-xy-legend');
const xyDataLabelInput  = $('opt-xy-data-label');

// Popovers: "Layout options" and "Diagram options" share one positioning routine.
const optionPopovers = [$('layout-advanced'), $('diagram-advanced')].filter(Boolean);

syncLayoutControls();
updateLayoutControlsState();
layoutControlsReady = true;

[layoutSelect, lookSelect, inheritDirInput, elkPlacementInput, elkMergeEdges,
 elkFeedbackInput, elkEntryInput, elkStraightenInput, elkLineHopsInput,
 stepNumbersInput, stepDurationInput, mindmapColorInput, packetBitInput,
 xyLegendInput, xyDataLabelInput].forEach(el => {
    if (el) el.addEventListener('change', applyLayoutSettingsFromUI);
});
stepDurationInput?.addEventListener('input', () => {
    if (stepDurationLabel) stepDurationLabel.textContent = `${stepDurationInput.value}s`;
});

optionPopovers.forEach(popover => {
    const panel = popover.querySelector('.layout-advanced-panel');

    popover.addEventListener('toggle', () => {
        if (!popover.open) {
            panel.classList.remove('is-positioned');
            return;
        }
        // Only one option popover may be open at a time.
        optionPopovers.forEach(other => { if (other !== popover) other.open = false; });
        requestAnimationFrame(() => positionOptionPanel(popover));
    });
});

document.addEventListener('click', e => {
    optionPopovers.forEach(popover => {
        if (popover.open && !popover.contains(e.target)) popover.open = false;
    });
});

function repositionOpenOptionPanels() {
    optionPopovers.forEach(popover => {
        if (popover.open) positionOptionPanel(popover);
    });
}

window.addEventListener('resize', repositionOpenOptionPanels);
window.addEventListener('scroll', repositionOpenOptionPanels, true);

// ── Toolbar — editor pane ──────────────────────────────────────────────────
const autoRenderToggle = $('auto-render-toggle');
const renderButton = $('btn-render');

function updateAutoRenderUI() {
    autoRenderToggle.checked = autoRender;
    renderButton.disabled = autoRender;
    renderButton.title = autoRender
        ? 'Render is automatic while typing'
        : 'Render now (Ctrl+Enter)';
}

autoRenderToggle.checked = autoRender;
updateAutoRenderUI();

autoRenderToggle.addEventListener('change', async e => {
    autoRender = e.target.checked;
    localStorage.setItem(LS_AUTO_RENDER, String(autoRender));
    updateAutoRenderUI();
    if (autoRender) {
        const { errorLine, errorMsg } = await renderNow(getSource());
        handleRenderResult(errorLine, errorMsg);
    }
});

// Template picker — the option groups are generated from the template registry
// so the markup and the templates can never drift apart.
function buildTemplateMenu(select, templates) {
    let currentGroup = null;
    let groupEl      = null;

    for (const tpl of templates) {
        if (tpl.group !== currentGroup) {
            currentGroup = tpl.group;
            groupEl = document.createElement('optgroup');
            groupEl.label = currentGroup;
            select.appendChild(groupEl);
        }
        const opt = document.createElement('option');
        opt.value = tpl.id;
        opt.textContent = tpl.label;
        groupEl.appendChild(opt);
    }
}

const templateSelect = $('template-select');
buildTemplateMenu(templateSelect, TEMPLATES);

templateSelect.addEventListener('change', e => {
    const tpl = TEMPLATES.find(t => t.id === e.target.value);
    if (tpl) {
        // Only ask before overwriting if the current diagram was actually edited.
        if (!isSourceUnedited() && !confirm('Replace current diagram with the template?')) {
            e.target.value = '';
            return;
        }
        setActiveTabSource(tpl.source);
        e.target.value = '';
        focusEditor();
    }
});

// Force render (Ctrl+Enter)
renderButton.addEventListener('click', async () => {
    const { errorLine, errorMsg } = await renderNow(getSource());
    handleRenderResult(errorLine, errorMsg);
});

// Copy source
$('btn-copy').addEventListener('click', async () => {
    const ok = await copySource();
    showBtnFeedback($('btn-copy'), ok ? '✓ Copied' : '✗ Failed', ok ? 'success' : 'error');
});

// Line wrap toggle
$('btn-wrap').addEventListener('click', () => {
    const on = toggleLineWrap();
    $('btn-wrap').classList.toggle('active', on);
    $('btn-wrap').title = on ? 'Disable line wrap' : 'Enable line wrap';
});

// New / clear
$('btn-new').addEventListener('click', () => {
    createTab();
    focusEditor();
});

// ── Toolbar — preview pane ─────────────────────────────────────────────────
$('btn-zoom-in').addEventListener('click',  () => { zoomIn();       });
$('btn-zoom-out').addEventListener('click', () => { zoomOut();      });
$('btn-fit').addEventListener('click',      () => { fitToScreen();  });
$('btn-reset-zoom').addEventListener('click', () => { resetZoom();  });

// Click on zoom display to enter custom value
zoomDisplay.addEventListener('click', () => {
    const cur  = Math.round(getScale() * 100);
    const input = prompt('Set zoom level (%):', cur);
    if (input === null) return;
    const pct = parseInt(input, 10);
    if (!isNaN(pct) && pct > 0) setZoomToValue(pct);
});

// ── Save / export dropdown ─────────────────────────────────────────────────
const saveBtn      = $('btn-save');
const saveDropdown = $('save-dropdown');

saveBtn.addEventListener('click', e => {
    e.stopPropagation();
    const willShow = !saveDropdown.classList.contains('show');
    if (willShow) {
        const rect = saveBtn.getBoundingClientRect();
        saveDropdown.style.top   = (rect.bottom + 4) + 'px';
        saveDropdown.style.right = (window.innerWidth - rect.right) + 'px';
    }
    saveDropdown.classList.toggle('show');
    if (willShow) updateSaveDropdownLabel();
});

document.addEventListener('click', () => saveDropdown.classList.remove('show'));
saveDropdown.addEventListener('click', e => e.stopPropagation());

async function doSave(action) {
    saveDropdown.classList.remove('show');
    const svg = getCurrentSVG();
    if (!svg) { alert('Nothing to save — the diagram has not rendered yet.'); return; }
    const src  = getSource();
    const name = buildFilename();
    const scale = getScale();
    const theme = getMermaidTheme();

    try {
        switch (action) {
            case 'png-1x':      await savePNG(svg, src, name + '.png', 1, theme);   break;
            case 'png-2x':      await savePNG(svg, src, name + '@2x.png', 2, theme); break;
            case 'png-zoom':    await savePNG(svg, src, name + `@${Math.round(scale*100)}pct.png`, scale, theme); break;
            case 'svg':         saveSVG(svg, src, name + '.svg');             break;
            case 'preview-png': await previewPNGInTab(svg, src, 1, theme);          break;
            case 'preview-png-zoom': await previewPNGInTab(svg, src, scale, theme); break;
            case 'preview-svg': previewSVGInTab(svg, src);                   break;
        }
    } catch (err) {
        alert('Export failed: ' + err.message);
    }
}

saveDropdown.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => doSave(el.dataset.action));
});

// Update the "current zoom" label in the dropdown dynamically
function updateSaveDropdownLabel() {
    const el = saveDropdown.querySelector('[data-action="png-zoom"] .zoom-val');
    if (el) el.textContent = `${Math.round(getScale() * 100)}%`;
    const el2 = saveDropdown.querySelector('[data-action="preview-png-zoom"] .zoom-val');
    if (el2) el2.textContent = `${Math.round(getScale() * 100)}%`;
}
function buildFilename() {
    const activeTab = getActiveTab();
    const baseName = sanitizeFilename(activeTab?.name || 'diagram');
    return `${baseName}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
}

// Layout/look/theme options are stored per tab and in LS_LAYOUT_OPTS as a
// versioned envelope (see LS_LAYOUT_OPTS_SCHEMA next to the other keys).

function loadLayoutOptions() {
    const defaults = getDefaultMermaidLayoutOptions();
    try {
        const parsed = JSON.parse(localStorage.getItem(LS_LAYOUT_OPTS) || '{}');
        // Older builds stored a bare options object without the newer keys;
        // in that case start from the current defaults instead of half-migrated state.
        if (parsed.version !== LS_LAYOUT_OPTS_SCHEMA) return { ...defaults };
        return normalizeLayoutOptions({ ...defaults, ...parsed.options });
    } catch {
        return { ...defaults };
    }
}

function persistLayoutOptions() {
    localStorage.setItem(LS_LAYOUT_OPTS, JSON.stringify({
        version: LS_LAYOUT_OPTS_SCHEMA,
        options: layoutOptions,
    }));
}

function syncLayoutControls() {
    const o = layoutOptions;
    layoutSelect.value      = o.layout;
    lookSelect.value        = o.look;
    inheritDirInput.checked = o.inheritDir;
    elkPlacementInput.value = o.elkNodePlacementStrategy;
    elkMergeEdges.checked    = o.elkMergeEdges;
    elkFeedbackInput.checked = o.elkOrientFeedbackEdges;
    elkEntryInput.checked    = o.elkKeepEntryNodeOnTop;
    elkStraightenInput.checked = o.elkStraightenEdges;
    elkLineHopsInput.checked   = o.elkLineHops;

    stepNumbersInput.checked = o.flowchartStepNumbers;
    stepDurationInput.value  = String(o.flowchartStepDuration);
    if (stepDurationLabel) stepDurationLabel.textContent = `${o.flowchartStepDuration}s`;
    mindmapColorInput.value = o.mindmapColorBy;
    packetBitInput.value    = o.packetBitOrder;
    xyLegendInput.checked   = o.xyChartShowLegend;
    xyDataLabelInput.checked = o.xyChartShowDataLabel;
}

function updateLayoutControlsState() {
    const elkEnabled = layoutSelect.value === 'elk';
    [elkPlacementInput, elkMergeEdges, elkFeedbackInput, elkEntryInput,
     elkStraightenInput, elkLineHopsInput].forEach(el => { el.disabled = !elkEnabled; });

    const diagramType = String(detectDiagramType());

    // Grey out layout engines this diagram type rejects; the selected engine is
    // kept visible so the user's preference is never silently overwritten.
    for (const opt of layoutSelect.options) {
        opt.disabled = !isLayoutSupported(opt.value, diagramType);
    }
    const isFallback = !isLayoutSupported(layoutOptions.layout, diagramType);
    layoutSelect.classList.toggle('is-fallback', isFallback);
    layoutSelect.title = isFallback
        ? `${layoutOptions.layout.toUpperCase()} is not supported for ${diagramType} diagrams — Mermaid falls back to ${getEffectiveLayout(diagramType)}`
        : 'Diagram layout engine';

    // Step animation only exists for flowchart edges.
    const isFlowchart = diagramType.startsWith('flowchart');
    stepNumbersInput.disabled  = !isFlowchart;
    stepDurationInput.disabled = !isFlowchart;
}

async function applyLayoutSettingsFromUI() {
    layoutOptions = normalizeLayoutOptions({
        ...getMermaidLayoutOptions(),
        layout:                   layoutSelect.value,
        look:                     lookSelect.value,
        inheritDir:               inheritDirInput.checked,
        elkNodePlacementStrategy: elkPlacementInput.value,
        elkMergeEdges:            elkMergeEdges.checked,
        elkOrientFeedbackEdges:   elkFeedbackInput.checked,
        elkKeepEntryNodeOnTop:    elkEntryInput.checked,
        elkStraightenEdges:       elkStraightenInput.checked,
        elkLineHops:              elkLineHopsInput.checked,
        flowchartStepNumbers:     stepNumbersInput.checked,
        flowchartStepDuration:    stepDurationInput.value,
        mindmapColorBy:           mindmapColorInput.value,
        packetBitOrder:           packetBitInput.value,
        xyChartShowLegend:        xyLegendInput.checked,
        xyChartShowDataLabel:     xyDataLabelInput.checked,
    });
    setMermaidLayoutOptions(layoutOptions);
    persistLayoutOptions();
    const activeTab = getActiveTab();
    if (activeTab) { activeTab.layoutOptions = { ...layoutOptions }; persistTabs(); }
    syncLayoutControls();
    updateLayoutControlsState();
    const { errorLine, errorMsg } = await rerenderPreview(getSource());
    handleRenderResult(errorLine, errorMsg);
}

function positionOptionPanel(popover) {
    const summary = popover.querySelector('summary');
    const panel   = popover.querySelector('.layout-advanced-panel');
    if (!summary || !panel) return;

    const rect = summary.getBoundingClientRect();
    const panelWidth  = Math.max(220, panel.offsetWidth || 220);
    const panelHeight = panel.offsetHeight || 260;
    const left = Math.min(
        Math.max(8, rect.right - panelWidth),
        window.innerWidth - panelWidth - 8
    );
    const below = rect.bottom + 6;
    const top   = (below + panelHeight > window.innerHeight - 8)
        ? Math.max(8, rect.top - panelHeight - 6)
        : below;

    panel.style.top  = `${top}px`;
    panel.style.left = `${left}px`;
    panel.classList.add('is-positioned');
}

// ── Import button ──────────────────────────────────────────────────────────
$('btn-import').addEventListener('click', () => $('file-input').click());

$('file-input').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await importFile(file);
});

async function importFile(file) {
    if (file.size > 2 * 1024 * 1024) {
        alert('File is too large to import (max 2 MB).');
        return;
    }
    try {
        const src = await extractSourceFromFile(file);
        if (!src) {
            alert('No Mermaid source found in the file.\n\nOnly files exported from this editor (PNG/SVG) or plain .mmd files are supported.');
            return;
        }
        if (src.length > 200_000) {
            alert('Diagram source is too large to import (max 200,000 characters).');
            return;
        }
        createTab({
            name: file.name || buildUntitledName(),
            source: src,
        });
        focusEditor();
    } catch (err) {
        alert('Import failed: ' + err.message);
    }
}

// ── Drag & drop onto editor pane ───────────────────────────────────────────
const editorDrop = $('editor-drop-overlay');

editorPane.addEventListener('dragenter', e => {
    if (hasSupportedFile(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation();
        editorDrop.classList.add('visible');
    }
});

editorPane.addEventListener('dragover', e => {
    if (hasSupportedFile(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation();
    }
});

editorPane.addEventListener('dragleave', e => {
    if (!editorPane.contains(e.relatedTarget)) {
        editorDrop.classList.remove('visible');
    }
});

editorPane.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    editorDrop.classList.remove('visible');
    const file = e.dataTransfer?.files?.[0];
    if (file) await importFile(file);
});

function hasSupportedFile(dt) {
    if (!dt) return false;
    if (dt.files?.length) return true;
    for (const item of (dt.items || [])) {
        if (item.kind === 'file') return true;
    }
    return false;
}

// ── Drag & drop onto preview pane ─────────────────────────────────────────
const previewDrop = $('preview-drop-overlay');

previewArea.parentElement.addEventListener('dragenter', e => {
    if (hasSupportedFile(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation();
        previewDrop.classList.add('visible');
    }
});

previewArea.parentElement.addEventListener('dragover', e => {
    if (hasSupportedFile(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation();
    }
});

previewArea.parentElement.addEventListener('dragleave', e => {
    if (!previewArea.parentElement.contains(e.relatedTarget)) {
        previewDrop.classList.remove('visible');
    }
});

previewArea.parentElement.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    previewDrop.classList.remove('visible');
    const file = e.dataTransfer?.files?.[0];
    if (file) await importFile(file);
});

// ── Pane splitter ──────────────────────────────────────────────────────────
const splitter = $('pane-splitter');
let   isSplitting = false;
let   splitStartX, splitStartW;

splitter.addEventListener('pointerdown', e => {
    isSplitting = true;
    splitStartX = e.clientX;
    splitStartW = editorPane.offsetWidth;
    document.body.classList.add('no-select');
    splitter.setPointerCapture(e.pointerId);
});

splitter.addEventListener('pointermove', e => {
    if (!isSplitting) return;
    const dx = e.clientX - splitStartX;
    const newW = Math.max(220, Math.min(splitStartW + dx,
                window.innerWidth - 220 - splitter.offsetWidth));
    editorPane.style.width = newW + 'px';
    editorPane.style.flex  = 'none';
    cmEditor.refresh();
    updateTabScrollButtons();
});

splitter.addEventListener('pointerup', () => {
    if (!isSplitting) return;
    isSplitting = false;
    document.body.classList.remove('no-select');
    localStorage.setItem(LS_PANE_WIDTH, editorPane.style.width);
    cmEditor.refresh();
    // Do NOT call fitToScreen() here — preserve the user's current zoom level.
    // The diagram's pan/zoom state is independent of the pane width.
});

// Double-click splitter → reset 50/50
splitter.addEventListener('dblclick', () => {
    editorPane.style.width = '';
    editorPane.style.flex  = '';
    localStorage.removeItem(LS_PANE_WIDTH);
    cmEditor.refresh();
    fitToScreen();
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', async e => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+Enter  → force render
    if (ctrl && e.key === 'Enter') {
        if (autoRender) return;
        e.preventDefault();
        const { errorLine, errorMsg } = await renderNow(getSource());
        handleRenderResult(errorLine, errorMsg);
    }

    // Ctrl+S  → save PNG 1x
    if (ctrl && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        doSave('png-1x');
    }

    // Ctrl+Shift+S  → save SVG
    if (ctrl && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        doSave('svg');
    }

    // Ctrl+Shift+F → fit to screen
    if (ctrl && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        fitToScreen();
    }

    if (ctrl && e.key === 't' && !e.shiftKey) {
        e.preventDefault();
        createTab();
    }

    if (ctrl && e.key === 'w' && !e.shiftKey) {
        e.preventDefault();
        closeTab(activeTabId);
    }
});

// ── Button feedback helper ──────────────────────────────────────────────────
const _btnFeedbackTimers = new WeakMap();

function showBtnFeedback(btn, text, type = 'success') {
    if (!btn.dataset.defaultHtml) btn.dataset.defaultHtml = btn.innerHTML;

    const timer = _btnFeedbackTimers.get(btn);
    if (timer) clearTimeout(timer);

    btn.innerHTML = text;
    btn.classList.remove('btn-feedback-success', 'btn-feedback-error');
    btn.classList.add(`btn-feedback-${type}`);

    const resetTimer = setTimeout(() => {
        btn.innerHTML = btn.dataset.defaultHtml;
        btn.classList.remove('btn-feedback-success', 'btn-feedback-error');
        _btnFeedbackTimers.delete(btn);
    }, 1800);

    _btnFeedbackTimers.set(btn, resetTimer);
}

// ── Initial status bar ─────────────────────────────────────────────────────
renderTabs();
updateStatusBar();

$('btn-add-tab').addEventListener('click', () => createTab());

btnTabsScrollLeft.addEventListener('click', () => {
    tabsHost.scrollBy({ left: -120, behavior: 'smooth' });
});
btnTabsScrollRight.addEventListener('click', () => {
    tabsHost.scrollBy({ left: 120, behavior: 'smooth' });
});

tabsHost.addEventListener('scroll', () => updateTabScrollButtons());

tabsHost.addEventListener('wheel', e => {
    if (e.deltaY === 0) return;
    e.preventDefault();
    tabsHost.scrollBy({ left: e.deltaY * 0.8, behavior: 'smooth' });
}, { passive: false });
tabsHost.addEventListener('click', e => {
    const closeBtn = e.target.closest('[data-close-tab]');
    if (closeBtn) {
        closeTab(closeBtn.dataset.closeTab);
        return;
    }

    if (e.target.closest('[data-rename-input]')) return;

    const tabBtn = e.target.closest('[data-tab-id]');
    if (tabBtn) switchTab(tabBtn.dataset.tabId);
});

tabsHost.addEventListener('dblclick', e => {
    if (e.target.closest('[data-close-tab]') || e.target.closest('[data-rename-input]')) return;
    const tabBtn = e.target.closest('[data-tab-id]');
    if (tabBtn) beginTabRename(tabBtn.dataset.tabId);
});

tabsHost.addEventListener('keydown', e => {
    const renameInput = e.target.closest('[data-rename-input]');
    if (renameInput) {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishTabRename(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishTabRename(false);
        }
        return;
    }

    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
    const tabs = [...tabsHost.querySelectorAll('[data-tab-id]')];
    if (!tabs.length) return;
    const currentTab = e.target.closest('[data-tab-id]');
    const idx = currentTab ? tabs.indexOf(currentTab) : 0;

    if (e.key === 'Enter' || e.key === ' ') {
        if (!currentTab) return;
        e.preventDefault();
        switchTab(currentTab.dataset.tabId);
        return;
    }

    e.preventDefault();
    const nextIdx = e.key === 'ArrowRight'
        ? (idx + 1) % tabs.length
        : (idx - 1 + tabs.length) % tabs.length;
    tabs[nextIdx].focus();
    switchTab(tabs[nextIdx].dataset.tabId);
});

tabsHost.addEventListener('focusout', e => {
    if (!e.target.closest('[data-rename-input]')) return;
    finishTabRename(true);
});

function loadTabs() {
    try {
        const raw = localStorage.getItem(LS_TABS);
        if (!raw) return [makeTab({ existingTabs: [] })];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.length) return [makeTab({ existingTabs: [] })];
        const normalized = parsed.map((tab, index) => normalizeTab(tab, parsed.slice(0, index))).filter(Boolean).slice(0, 20);
        return normalized.length ? normalized : [makeTab({ existingTabs: [] })];
    } catch {
        return [makeTab({ existingTabs: [] })];
    }
}

function normalizeTab(tab, existingTabs = []) {
    if (!tab || typeof tab !== 'object') return null;
    const source = String(tab.source || DEFAULT_DIAGRAM);
    const normalizedTabs = existingTabs.map(item => ({
        name: String(item?.name || ''),
    }));
    const tabMermaidTheme = isValidMermaidTheme(tab.mermaidTheme) ? tab.mermaidTheme : mermaidTheme;
    const defaults = getDefaultMermaidLayoutOptions();
    const rawLayout = (tab.layoutOptions && typeof tab.layoutOptions === 'object') ? tab.layoutOptions : layoutOptions;
    const tabLayoutOptions = normalizeLayoutOptions({ ...defaults, ...rawLayout });
    return {
        id: String(tab.id || crypto.randomUUID()),
        name: String(tab.name || buildUntitledName(normalizedTabs)),
        source,
        type: String(tab.type || detectTypeFromSource(source)),
        preview: normalizePreviewTransform(tab.preview),
        mermaidTheme: tabMermaidTheme,
        layoutOptions: tabLayoutOptions,
    };
}

function normalizePreviewTransform(preview) {
    if (!preview || typeof preview !== 'object') return null;
    const scale = Number(preview.scale);
    const tx = Number(preview.tx);
    const ty = Number(preview.ty);
    if (!Number.isFinite(scale) || !Number.isFinite(tx) || !Number.isFinite(ty)) return null;
    return { scale, tx, ty };
}

function persistTabs() {
    localStorage.setItem(LS_TABS, JSON.stringify(openTabs));
}

function getActiveTab() {
    return openTabs.find(tab => tab.id === activeTabId) || openTabs[0] || null;
}

function updateActiveTabSource(src) {
    const activeTab = getActiveTab();
    if (!activeTab) return;
    activeTab.source = src;
    const newType = parseDiagramType(src);
    const typeChanged = activeTab.type !== newType;
    activeTab.type = newType;
    persistSource(src);
    if (typeChanged) renderTabs();
}

function updateActiveTabPreview(preview) {
    const activeTab = getActiveTab();
    if (!activeTab) return;
    const normalizedPreview = normalizePreviewTransform(preview);
    if (!normalizedPreview) return;
    activeTab.preview = normalizedPreview;
    persistSource(activeTab.source);
}

function setActiveTabSource(src) {
    const activeTab = getActiveTab();
    if (!activeTab) return;
    activeTab.source = src;
    activeTab.type = detectTypeFromSource(src);
    persistTabs();
    renderTabs();
    clearStatusError();
    clearErrorHighlight();
    setEditorValue(src);
    renderNow(getSource()).then(({ errorLine, errorMsg }) => handleRenderResult(errorLine, errorMsg));
    updateStatusBar();
    cmEditor.refresh();
}

function setEditorValue(src) {
    isSwitchingTabs = true;
    setSource(src);
    isSwitchingTabs = false;
    pristineSource = src ?? '';
}

// True when the editor still matches whatever the app last put into it,
// i.e. the user has not typed anything since.
function isSourceUnedited() {
    const current = getSource();
    if (!current.trim()) return true;
    return current.trim() === pristineSource.trim();
}

function applyTabPreviewSettings(tab) {
    if (!tab) return;
    if (tab.mermaidTheme) {
        mermaidTheme = tab.mermaidTheme;
        mmdThemeSelect.value = mermaidTheme;
        setMermaidTheme(mermaidTheme, tab.source); // updates _mermaidTheme; render will be superseded
    }
    if (tab.layoutOptions) {
        layoutOptions = { ...tab.layoutOptions };
        setMermaidLayoutOptions(layoutOptions);
        syncLayoutControls();
        updateLayoutControlsState();
    }
}

function switchTab(tabId) {
    if (!tabId || tabId === activeTabId) return;
    const nextTab = openTabs.find(tab => tab.id === tabId);
    if (!nextTab) return;
    activeTabId = nextTab.id;
    clearStatusError();
    clearErrorHighlight();
    applyTabPreviewSettings(nextTab);
    renderTabs();
    setEditorValue(nextTab.source);
    renderNow(getSource()).then(({ errorLine, errorMsg }) => {
        if (nextTab.preview) restoreTransform(nextTab.preview);
        else updateActiveTabPreview(getCurrentTransform());
        handleRenderResult(errorLine, errorMsg);
    });
    updateStatusBar();
    cmEditor.refresh();
    focusEditor();
}

function createTab({ name, source } = {}) {
    const tab = makeTab({ name, source, existingTabs: openTabs });
    openTabs.push(tab);
    activeTabId = tab.id;
    persistTabs();
    renderTabs();
    clearStatusError();
    clearErrorHighlight();
    setEditorValue(tab.source);
    renderNow(getSource()).then(({ errorLine, errorMsg }) => {
        updateActiveTabPreview(getCurrentTransform());
        handleRenderResult(errorLine, errorMsg);
    });
    updateStatusBar();
    cmEditor.refresh();
}

function closeTab(tabId) {
    if (openTabs.length === 1) {
        const onlyTab = getActiveTab();
        if (!onlyTab) return;
        if (onlyTab.source !== DEFAULT_DIAGRAM && onlyTab.source.trim() &&
            !confirm('Clear this diagram? This cannot be undone.')) return;
        onlyTab.name = buildUntitledName([]);
        onlyTab.source = DEFAULT_DIAGRAM;
        onlyTab.type = detectTypeFromSource(DEFAULT_DIAGRAM);
        persistTabs();
        renderTabs();
        clearStatusError();
        clearErrorHighlight();
        setEditorValue(DEFAULT_DIAGRAM);
        renderNow(getSource()).then(({ errorLine, errorMsg }) => {
            updateActiveTabPreview(getCurrentTransform());
            handleRenderResult(errorLine, errorMsg);
        });
        updateStatusBar();
        focusEditor();
        return;
    }

    const idx = openTabs.findIndex(tab => tab.id === tabId);
    if (idx === -1) return;
    const wasActive = openTabs[idx].id === activeTabId;
    openTabs.splice(idx, 1);

    if (wasActive) {
        activeTabId = openTabs[Math.max(0, idx - 1)]?.id ?? openTabs[0].id;
        const activeTab = getActiveTab();
        clearStatusError();
        clearErrorHighlight();
        applyTabPreviewSettings(activeTab);
        setEditorValue(activeTab.source);
        renderNow(getSource()).then(({ errorLine, errorMsg }) => {
            if (activeTab.preview) restoreTransform(activeTab.preview);
            else updateActiveTabPreview(getCurrentTransform());
            handleRenderResult(errorLine, errorMsg);
        });
    }

    persistTabs();
    renderTabs();
    updateStatusBar();
    cmEditor.refresh();
}

function renderTabs() {
    tabsHost.innerHTML = openTabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const isRenaming = tab.id === renamingTabId;
        const safeId   = escapeHtml(tab.id);
        const safeName = escapeHtml(tab.name);
        const type = escapeHtml(tab.type || 'diagram');
        const nameMarkup = isRenaming
            ? `<input class="editor-tab-rename-input" type="text" value="${safeName}" data-rename-input="${safeId}" aria-label="Rename tab ${safeName}" />`
            : `<span class="editor-tab-name" title="${safeName}">${safeName}</span>`;
        return `
            <div class="editor-tab${isActive ? ' active' : ''}" role="tab" tabindex="${isActive ? '0' : '-1'}" aria-selected="${isActive}" data-tab-id="${safeId}">
                ${nameMarkup}
                <span class="editor-tab-type">${type}</span>
                <span class="editor-tab-close" data-close-tab="${safeId}" aria-label="Close ${safeName}" title="Close tab">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </span>
            </div>
        `;
    }).join('');

    if (renamingTabId) {
        const input = tabsHost.querySelector('[data-rename-input]');
        if (input) {
            input.focus();
            input.select();
        }
    }

    updateTabScrollButtons();
}

function updateTabScrollButtons() {
    const scrollable = tabsHost.scrollWidth > tabsHost.clientWidth + 1;
    btnTabsScrollLeft.hidden  = !scrollable || tabsHost.scrollLeft <= 0;
    btnTabsScrollRight.hidden = !scrollable || tabsHost.scrollLeft >= tabsHost.scrollWidth - tabsHost.clientWidth - 1;
}

function beginTabRename(tabId) {
    const tab = openTabs.find(candidate => candidate.id === tabId);
    if (!tab) return;
    if (tab.id !== activeTabId) switchTab(tab.id);
    renamingTabId = tab.id;
    renderTabs();
}

function finishTabRename(commit) {
    if (!renamingTabId) return;
    const tabId = renamingTabId;
    const tab = openTabs.find(candidate => candidate.id === tabId);
    const input = tabsHost.querySelector('[data-rename-input]');
    if (commit && tab && input) {
        const nextName = input.value.trim();
        if (nextName) tab.name = nextName;
        persistTabs();
    }
    renamingTabId = null;
    renderTabs();
    [...tabsHost.querySelectorAll('[data-tab-id]')]
        .find(element => element.dataset.tabId === tabId)
        ?.focus();
}

function makeTab({ name, source, existingTabs } = {}) {
    const tabs = existingTabs ?? openTabs;
    const finalSource = source ?? DEFAULT_DIAGRAM;
    return {
        id: crypto.randomUUID(),
        name: name || buildUntitledName(tabs),
        source: finalSource,
        type: detectTypeFromSource(finalSource),
        preview: normalizePreviewTransform(getCurrentTransform()),
        mermaidTheme,
        layoutOptions: { ...layoutOptions },
    };
}

function buildUntitledName(tabs = []) {
    let max = 0;
    for (const tab of tabs) {
        const m = tab.name?.match(/^Untitled (\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `Untitled ${max + 1}`;
}

function detectTypeFromSource(src) {
    return parseDiagramType(src);
}

function sanitizeFilename(name) {
    return String(name || 'diagram')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'diagram';
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
        })();
    } catch (err) {
        console.error(err);
        bootError(err && err.message ? err.message : String(err));
    }
}());
