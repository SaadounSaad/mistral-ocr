# OCRLearning — Documentation technique

> Application web **100 % client-side** de reconnaissance optique de caractères (OCR) basée sur l'API Mistral OCR, avec éditeur de texte enrichi, export Word et support **PWA** (installable sur iPhone, Android et bureau).

---

## Table des matières

1. [Présentation](#1-présentation)
2. [Prérequis](#2-prérequis)
3. [Architecture des fichiers](#3-architecture-des-fichiers)
4. [Flux de fonctionnement](#4-flux-de-fonctionnement)
5. [Analyse détaillée — index.html](#5-analyse-détaillée--indexhtml)
6. [Analyse détaillée — app.js](#6-analyse-détaillée--appjs)
7. [Analyse détaillée — style.css](#7-analyse-détaillée--stylecss)
8. [PWA & Service Worker](#8-pwa--service-worker)
9. [Bibliothèques externes](#9-bibliothèques-externes)
10. [Algorithmes clés](#10-algorithmes-clés)
11. [Raccourcis clavier](#11-raccourcis-clavier)
12. [Limitations connues](#12-limitations-connues)

---

## 1. Présentation

**OCRLearning** est une SPA (Single Page Application) sans backend ni serveur, désormais également installable comme **Progressive Web App (PWA)**.  
L'utilisateur charge un fichier PDF ou image directement dans son navigateur — ou prend une photo avec son iPhone — ; l'application le transmet à l'API Mistral OCR, reçoit le texte extrait et l'affiche dans un éditeur riche côte à côte avec le document source.

### Fonctionnalités principales

| Fonctionnalité | Détail |
|---|---|
| Upload PDF / image | Drag & drop ou sélection fichier (≤ 50 MB) |
| **Bouton caméra** | Ouvre l'appareil photo arrière sur iPhone/Android directement |
| Vue double panneau | Source (PDF/image) à gauche, output éditable à droite |
| Navigation synchronisée | Prev / Next / PageUp / PageDown / Aller à la page N |
| Édition riche | H1, H2, H3, Paragraphe, Gras, Italique, Surlignage couleur |
| Table des matières | Générée depuis les titres H1/H2/H3, insertable en tête de document |
| Couper fin | Supprime depuis le curseur jusqu'à la fin de la page courante |
| Export DOCX | Téléchargement Word avec sauts de page natifs |
| Clé API persistante | Stockée en `localStorage`, jamais envoyée ailleurs qu'à Mistral |
| Nettoyage OCR | Suppression automatique des numéros de page, en-têtes courants, notes de bas de page |
| **PWA installable** | Fonctionne hors ligne (app shell mis en cache), installable sur écran d'accueil |

---

## 2. Prérequis

### Pour l'utilisateur final

- **Navigateur moderne** : Chrome 90+, Firefox 90+, Edge 90+, Safari 15+  
  (requis pour : `fetch`, `FileReader`, `contenteditable`, `\p{Nd}` regex Unicode, `URL.createObjectURL`, Service Worker)
- **Clé API Mistral** : obtenue sur [console.mistral.ai](https://console.mistral.ai/api-keys/)  
  — modèle utilisé : `mistral-ocr-latest`
- **Connexion internet** : pour appeler l'API Mistral et charger les CDN au premier lancement  
  (les ressources sont ensuite mises en cache — l'interface fonctionne hors ligne)

### Installation sur iPhone (PWA)

1. Ouvrir l'URL dans **Safari**
2. Bouton Partage → **"Sur l'écran d'accueil"**
3. L'app s'installe comme une app native (plein écran, icône bleue)

> Le bouton **"Take a photo"** ouvre l'appareil photo arrière via `capture="environment"`.  
> Sur desktop, il agit comme un sélecteur de fichier classique.

### Pour le développeur

- Aucun build tool, aucun npm, aucun serveur Node
- Les fichiers statiques doivent être servis via **HTTPS** pour que le Service Worker s'active  
  (exception : `localhost` fonctionne aussi en HTTP)
- Servable depuis GitHub Pages, Netlify, Apache, Nginx, etc.

---

## 3. Architecture des fichiers

```
Mistral OCR/
├── index.html        — Structure HTML, modales, workspace, CDN imports
├── style.css         — Styles (reset, composants, layout dual-panel, responsive)
├── app.js            — Logique applicative complète (OCR, nettoyage, édition, export)
├── manifest.json     — Manifeste PWA (nom, couleurs, icône, mode standalone)
├── sw.js             — Service Worker (cache app shell, network-only pour l'API)
├── icons/
│   └── icon.svg      — Icône de l'app (logo 2×2 carrés, toutes tailles)
└── README.md         — Ce fichier
```

---

## 4. Flux de fonctionnement

```
┌──────────────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Utilisateur          │────▶│  FileReader  │────▶│  callMistralOCR()    │
│  (PDF / image / 📷)  │     │  (DataURI)   │     │  POST /v1/ocr        │
└──────────────────────┘     └──────────────┘     └──────────┬───────────┘
                                                              │ result.pages[]
                                               ┌─────────────▼────────────┐
                                               │  cleanPageNumbers()       │
                                               │  (par page, 4 phases)     │
                                               └─────────────┬────────────┘
                                                             │
                                               ┌─────────────▼────────────┐
                                               │  removeRepeatedLines()    │
                                               │  (toutes pages)           │
                                               └─────────────┬────────────┘
                                                             │
                                         ┌───────────────────▼──────────────────┐
                                         │  navigateTo(0)                        │
                                         │  marked.parse(pg.markdown) → HTML     │
                                         │  → editor.innerHTML                   │
                                         └──────────────────────────────────────┘
```

---

## 5. Analyse détaillée — `index.html`

### Structure générale

```
<head>
  ├── Meta PWA (manifest, theme-color, apple-mobile-web-app-*, apple-touch-icon)
  ├── Style PWA inline (.drop-divider, .btn-camera)
  └── CDN : PDF.js · html-docx-js · marked.js · Inter (Google Fonts)

<body>
  ├── #apiKeyModal       — Modale saisie clé API (overlay)
  ├── #tocModal          — Modale table des matières (overlay)
  ├── .navbar            — Barre de navigation (logo + boutons)
  ├── #uploadSection     — Zone d'upload
  │     ├── Drop zone (drag & drop)
  │     ├── #browseBtn + #fileInput     — Sélection fichier classique
  │     ├── #cameraBtn + #cameraInput  — Appareil photo (capture="environment")
  │     └── #uploadLoading             — Spinner OCR en cours
  └── #workspaceSection  — Espace de travail (caché jusqu'au chargement OCR)
        ├── .panels
        │     ├── .panel (Source — PDF/image) → #pdfCanvas / #imgPreview
        │     └── .panel (Output — éditeur)
        │           ├── .toolbar  (H1/H2/H3/P, B/I, highlight, TOC, Couper fin, Export)
        │           └── #editor   (contenteditable)
        └── .page-nav    — Navigation Prev/Next/Page input

<script src="app.js">
<script inline>
  ├── Service Worker registration
  └── Camera button wiring → handleFile()
```

### Bibliothèques chargées (CDN)

| Lib | Version | Rôle |
|---|---|---|
| PDF.js | 3.11.174 | Rendu PDF page par page dans `<canvas>` |
| html-docx-js | 0.3.1 | Conversion HTML → DOCX côté client |
| marked.js | 9.x | Rendu Markdown → HTML |

### Bouton caméra

```html
<button class="btn-camera" id="cameraBtn">📷 Take a photo</button>
<input type="file" id="cameraInput" hidden accept="image/*" capture="environment" />
```

- `capture="environment"` → appareil photo **arrière** sur iPhone/Android
- Sur desktop → sélecteur de fichier standard (attribut ignoré)
- Déclenche le même pipeline `handleFile()` que le drag & drop

---

## 6. Analyse détaillée — `app.js`

### Constants & State

```js
const KEY_STORAGE  = 'ocrl_mistral_api_key';  // clé localStorage
const OCR_ENDPOINT = 'https://api.mistral.ai/v1/ocr';
const OCR_MODEL    = 'mistral-ocr-latest';
const MAX_BYTES    = 50 * 1024 * 1024;        // 50 MB

let pages       = [];   // [{ markdown, editedHtml, header, footer }]
let currentPage = 0;
let totalPages  = 0;
let pdfDoc      = null; // objet PDF.js
let fileIsImage = false;
let savedRange  = null; // sélection sauvegardée pour les actions toolbar
```

### Modules fonctionnels

#### 6.1 Gestion de la clé API
- Stockage : `localStorage.setItem('ocrl_mistral_api_key', val)`
- Lecture : `localStorage.getItem(KEY_STORAGE)`
- Bouton œil : bascule `input.type` entre `password` et `text`
- La modale se ferme au clic sur l'overlay si une clé est déjà enregistrée

#### 6.2 Upload & déclenchement OCR (`handleFile`)

```
handleFile(file)
  ├── Vérifie clé API (sinon → modale)
  ├── Vérifie taille (≤ 50 MB)
  ├── readFileAsDataURL() → base64 DataURI
  ├── callMistralOCR() → POST JSON { model, document, extract_header, extract_footer }
  ├── Pour chaque page : cleanPageNumbers(p.markdown)
  ├── removeRepeatedLines(pages)
  ├── PDF.js : pdfjsLib.getDocument() pour rendu source
  └── navigateTo(0)
```

> Appelé indifféremment depuis le drag & drop, le bouton Browse, ou le bouton Caméra.

#### 6.3 `cleanPageNumbers(md)` — nettoyage OCR en 4 phases

**Phase 1 — Chaîne de regex :**

| Pattern | Cible |
|---|---|
| `/<!--[\s\S]*?-->/g` | Marqueurs HTML OCR |
| `/^\[page[^\]]*\]$/ugim` | Tags `[page N]` |
| `/^#{1,6}[ \t]+(...){1,70}$/ugm → $1` | Strip `##` heading, conserve le texte |
| `/^\*{1,3}(...){1,70}\*{1,3}$/ugm → $1` | Strip gras/italic courts |
| `/^\p{Nd}+\s*[\p{Pd}]?$/ugm` | Chiffre seul sur une ligne (numéro de page) |
| `/^\p{Nd}+\s*[\/·]\s*\p{Nd}+$/ugm` | Fraction type `21/245` |
| `/^[\p{Pd}]?\s*[\p{L}]{0,8}\.?\s*\p{Nd}+\s*[\/·]\s*\p{Nd}+\s*[\p{Pd}]?$/ugm` | `— Page 21 / 245 —` |
| `/^\p{Nd}+\s+[\p{L}][\p{L}\s]{1,48}$/ugm` | `٢١ الفضيل بن عياض` |
| `/^\[\^\d+\]\|\^\d+\^\|[¹²³…]+/g` | Marqueurs de notes inline |

**Phase 2 — Suppression par séparateur (notes de bas de page) :**
- Scan **à rebours** pour trouver le **dernier** séparateur
- `isSep` : ligne composée uniquement de `[-—–_─━═\u2500-\u257F]`  
  (sans `*` — les étoiles sont des marqueurs décoratifs arabes)
- `isRef` : `/^[ \t]*[\(\[]?\p{Nd}+[\)\].]\s/u` — référence numérotée arabe ou latine
- Coupe si : pas de ligne après, ou première ligne après = `isRef`, ou ≤ 30 lignes après

**Phase 3 — Références sans séparateur :**
- Scan à rebours depuis la fin, collecte les lignes commençant par `isRef`
- Arrêt immédiat à la première ligne non-ref (évite les faux positifs)

**Phase 4 — Séparateurs orphelins :**
- Supprime toute ligne résiduelle composée de tirets/underscores/box-drawing

#### 6.4 `removeRepeatedLines(pages)` — suppression en-têtes courants

```
normLine(line) :
  → supprime chiffres/tirets en tête et en queue
  → "٢١ الفضيل بن عياض" et "٢٢ الفضيل بن عياض" → même clé "الفضيل بن عياض"

Comptage : chaque ligne normalisée < 80 chars, présente sur combien de pages ?
Seuil    : max(2, floor(N_pages × 0.25))
Action   : suppression de toutes les lignes dont la forme normalisée dépasse le seuil
```

#### 6.5 Navigation (`navigateTo`)

```
navigateTo(idx)
  ├── saveCurrentPage() → editor.innerHTML → pg.editedHtml
  ├── renderPdfPage(idx+1) — PDF.js rendu canvas
  └── editor.innerHTML = marked.parse(pg.markdown) si page non encore éditée
```

#### 6.6 Édition riche

- `document.execCommand('formatBlock', false, 'h1')` pour H1/H2/H3/P
- `document.execCommand('bold')` / `'italic'`
- Surlignage : injection de `<span style="background-color:…">` via `Range.surroundContents()`
- Suppression surlignage : `span.style.backgroundColor = ''` + unwrap si aucun style restant
- `savedRange` : sauvegarde de la sélection (les boutons toolbar ne volent pas le focus grâce à `e.preventDefault()` sur `mousedown`)

#### 6.7 Table des matières (TOC)

- `collectHeadings()` : parse tous les `pg.editedHtml` via un `<div>` temporaire, récupère H1/H2/H3
- `renderToc()` : affichage dans la modale avec indentation et lien cliquable → `navigateTo(page)`
- `insertTocBtn` : génère un bloc HTML stylé et le **prepend** à `pages[0].editedHtml`

#### 6.8 Export DOCX

```
exportDocx()
  ├── Pré-rend toutes les pages non visitées (marked.parse)
  ├── Génère le bloc TOC HTML si des headings existent
  ├── Pour chaque page :
  │     ├── html.replace(/<hr\b[^>]*>/gi, '')  — supprime les <hr> (évite lignes VML dans Word)
  │     └── Insère <p style="page-break-before:always"> entre pages
  ├── Assemble fullDoc HTML complet avec CSS embarqué (Calibri 11pt)
  └── htmlDocx.asBlob(fullDoc) → URL.createObjectURL → <a download>
```

---

## 7. Analyse détaillée — `style.css`

### Architecture CSS

| Section | Composants |
|---|---|
| Reset | `box-sizing`, marges/paddings à zéro |
| Utilitaires | `.hidden`, `.fw-bold` |
| Boutons | `.btn-primary`, `.btn-outline`, `.btn-sm`, `.btn-browse`, `.btn-key-edit` |
| Spinners | `.spinner` (40px), `.spinner-sm` (26px), animation `@keyframes spin` |
| Modales | `.modal-overlay` (backdrop blur), `.modal` (fadeUp), `.toc-modal` |
| Navbar | `.navbar` (52px, glassmorphism), `.nav-logo`, `.logo-mark` (grid 2×2) |
| Upload | `.upload-section`, `.drop-zone` (dashed border), `.upload-loading` |
| Workspace | `.workspace` (flex column, `height: calc(100vh - 52px)`) |
| Toolbar | `.toolbar`, `.fmt-btn`, `.hl-swatch`, `.toolbar-action-btn`, `.export-btn` |
| Panneaux | `.panels` (flex row), `.panel`, `.panel-body` (overflow-y: auto) |
| Éditeur | `#editor` (contenteditable, padding, typography H1/H2/H3/p/ul/table/code) |
| Navigation | `.page-nav`, `.nav-btn`, `.page-input` (number sans flèches natives) |
| Toast | `.toast`, `.toast.err`, `.toast.ok`, animation `slideUp` |
| Responsive | `@media (max-width: 680px)` — panels empilés verticalement |

> `.btn-camera` et `.drop-divider` sont définis dans un bloc `<style>` inline dans `index.html`  
> (évite de modifier `style.css` pour ces seuls éléments PWA).

### Points de design

- Palette : bleu `#3B82F6` (accent), gris `#1F2937` (texte), fond `#F0F6FF`
- Font : **Inter** (Google Fonts) avec fallback system-ui
- `body { overflow: hidden }` — workspace couvre exactement `100vh - 52px`, overridé en responsive

---

## 8. PWA & Service Worker

### `manifest.json`

```json
{
  "name": "OCRLearning",
  "short_name": "OCRLearning",
  "display": "standalone",
  "background_color": "#F0F6FF",
  "theme_color": "#3B82F6",
  "start_url": "./",
  "icons": [{ "src": "./icons/icon.svg", "sizes": "any", "purpose": "any maskable" }]
}
```

- `display: standalone` → barre d'URL masquée, look natif
- `purpose: any maskable` → icône adaptable aux formes Android (cercle, squircle…)

### `sw.js` — stratégies de cache

| Type de requête | Stratégie |
|---|---|
| `api.mistral.ai` | **Network-only** — les réponses OCR ne sont jamais mises en cache |
| Fichiers locaux (`index.html`, `style.css`, `app.js`, `manifest.json`, `icon.svg`) | **Cache-first** — pré-cachés à l'installation |
| CDN (PDF.js, marked.js, html-docx-js) | **Cache-first** — mis en cache au premier chargement |
| Google Fonts | **Network-first** avec fallback cache |

```
Install  → pre-cache SHELL (app + CDN)  → skipWaiting()
Activate → supprime anciens caches       → clients.claim()
Fetch    → route selon l'origine         → voir tableau ci-dessus
```

### `icons/icon.svg`

SVG scalable reprenant le logo 2×2 carrés de l'app sur fond bleu `#3B82F6`, arrondi `rx="96"`.  
Référencé dans `manifest.json` (`sizes: "any"`) et comme `apple-touch-icon` pour Safari iOS.

### Meta tags Apple (dans `<head>`)

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="OCRLearning" />
<link rel="apple-touch-icon" href="icons/icon.svg" />
```

---

## 9. Bibliothèques externes

### PDF.js (Mozilla) — v3.11.174
- **Usage** : rendu du PDF source page par page dans un `<canvas>`
- **Worker** : `pdf.worker.min.js` chargé depuis cdnjs (mis en cache par le SW)
- **Scale** : calculé dynamiquement selon la largeur du panneau source (max 2.5×)

### marked.js — v9.x
- **Usage** : conversion `pg.markdown` → HTML affiché dans `#editor`
- Appelé à chaque `navigateTo()` si la page n'a pas encore été rendue

### html-docx-js — v0.3.1
- **Usage** : `htmlDocx.asBlob(htmlString)` → `Blob` DOCX téléchargeable
- CSS embarqué contrôle la typographie Word (Calibri 11pt)
- Les `<hr>` sont supprimés avant export (évitent des lignes VML dans Word)

---

## 10. Algorithmes clés

### Détection de séparateur de notes de bas de page

```
Problème : Mistral OCR rend les notes de bas de page dans le flux du texte,
           précédées d'une ligne de séparation horizontale.

Signal   : ligne composée uniquement de tirets/underscores/box-drawing chars
           IMMÉDIATEMENT suivie d'une référence numérotée (1), ١., [1]…

Stratégie: scan à rebours (dernier séparateur = séparateur de note)
           → coupe à cet endroit, conserve le corps

Attention: les étoiles (* * *) ne sont PAS des séparateurs —
           ce sont des marqueurs décoratifs dans les livres arabes.
```

### Suppression des en-têtes courants

```
Problème : Mistral OCR inclut parfois le titre courant (chapitre)
           dans le flux markdown de chaque page.

Solution : compter les occurrences de chaque ligne courte (< 80 chars),
           normalisées (chiffres de tête/queue supprimés).
           Si ≥ 25 % des pages → ligne répétée → supprimée partout.

Exemple  : "٢١ الفضيل بن عياض" (p.21) et "٢٢ الفضيل بن عياض" (p.22)
           → normalisé → "الفضيل بن عياض" → même clé → comptés ensemble.
```

---

## 11. Raccourcis clavier

| Raccourci | Action |
|---|---|
| `PageUp` | Page précédente |
| `PageDown` | Page suivante |
| `Alt + ←` | Page précédente |
| `Alt + →` | Page suivante |
| `Entrée` (dans le champ page) | Aller à la page saisie |
| `Échap` (dans le champ page) | Annuler et restaurer le numéro actuel |

---

## 12. Limitations connues

| Limitation | Explication |
|---|---|
| Taille max 50 MB | Limite côté client (FileReader + base64 overhead) |
| HTTPS requis pour PWA | Le Service Worker ne s'active qu'en HTTPS (ou localhost) |
| Icône iOS en SVG | iOS < 16 peut ignorer l'icône SVG et utiliser un screenshot — fournir un PNG 180×180 pour garantir l'icône sur écran d'accueil |
| Pas de persistance des éditions | Les modifications sont perdues si la page est rechargée |
| Notes de bas de page multilignes | Seules les lignes commençant par une référence numérotée sont supprimées |
| Étoiles décoratives arabes `* * *` | Non supprimées (comportement voulu — marqueurs de passage) |
| Export DOCX RTL | Le sens du texte arabe/hébreu peut nécessiter un ajustement manuel dans Word |
| Clé API en clair | Stockée en `localStorage` — ne pas utiliser sur un poste partagé |
