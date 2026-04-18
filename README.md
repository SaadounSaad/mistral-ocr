# OCRLearning — Documentation technique

> Application web **100 % client-side** de reconnaissance optique de caractères (OCR) basée sur l'API Mistral OCR, avec éditeur de texte enrichi et export Word.

---

## Table des matières

1. [Présentation](#1-présentation)
2. [Prérequis](#2-prérequis)
3. [Architecture des fichiers](#3-architecture-des-fichiers)
4. [Flux de fonctionnement](#4-flux-de-fonctionnement)
5. [Analyse détaillée — index.html](#5-analyse-détaillée--indexhtml)
6. [Analyse détaillée — app.js](#6-analyse-détaillée--appjs)
7. [Analyse détaillée — style.css](#7-analyse-détaillée--stylecss)
8. [Bibliothèques externes](#8-bibliothèques-externes)
9. [Algorithmes clés](#9-algorithmes-clés)
10. [Raccourcis clavier](#10-raccourcis-clavier)
11. [Limitations connues](#11-limitations-connues)

---

## 1. Présentation

**OCRLearning** est une SPA (Single Page Application) sans backend ni serveur.  
L'utilisateur charge un fichier PDF ou image directement dans son navigateur ; l'application le transmet à l'API Mistral OCR, reçoit le texte extrait et l'affiche dans un éditeur riche côte à côte avec le document source.

### Fonctionnalités principales

| Fonctionnalité | Détail |
|---|---|
| Upload PDF / image | Drag & drop ou sélection fichier (≤ 50 MB) |
| Vue double panneau | Source (PDF/image) à gauche, output éditable à droite |
| Navigation synchronisée | Prev / Next / PageUp / PageDown / Aller à la page N |
| Édition riche | H1, H2, H3, Paragraphe, Gras, Italique, Surlignage couleur |
| Table des matières | Générée depuis les titres H1/H2/H3, insertable en tête de document |
| Couper fin | Supprime depuis le curseur jusqu'à la fin de la page courante |
| Export DOCX | Téléchargement Word avec sauts de page natifs |
| Clé API persistante | Stockée en `localStorage`, jamais envoyée ailleurs qu'à Mistral |
| Nettoyage OCR | Suppression automatique des numéros de page, en-têtes courants, notes de bas de page |

---

## 2. Prérequis

### Pour l'utilisateur final

- **Navigateur moderne** : Chrome 90+, Firefox 90+, Edge 90+, Safari 15+  
  (requis pour : `fetch`, `FileReader`, `contenteditable`, `\p{Nd}` regex Unicode, `URL.createObjectURL`)
- **Clé API Mistral** : obtenue sur [console.mistral.ai](https://console.mistral.ai/api-keys/)  
  — modèle utilisé : `mistral-ocr-latest`
- **Connexion internet** : pour appeler l'API Mistral et charger les CDN au premier lancement

### Pour le développeur

- Aucun build tool, aucun npm, aucun serveur Node
- Les fichiers statiques peuvent être servis via HTTP ou HTTPS  
  (GitHub Pages, Netlify, Apache, Nginx, etc.)

---

## 3. Architecture des fichiers

```
Mistral OCR/
├── index.html        — Structure HTML, modales, workspace, CDN imports
├── style.css         — Styles (reset, composants, layout dual-panel, responsive)
├── app.js            — Logique applicative complète (OCR, nettoyage, édition, export)
└── README.md         — Ce fichier
```

---

## 4. Flux de fonctionnement

```
┌──────────────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Utilisateur          │────▶│  FileReader  │────▶│  callMistralOCR()    │
│  (PDF / image)       │     │  (DataURI)   │     │  POST /v1/ocr        │
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
  ├── Meta (charset, viewport, theme-color)
  └── CDN : PDF.js · html-docx-js · marked.js · Inter (Google Fonts)

<body>
  ├── #apiKeyModal       — Modale saisie clé API (overlay)
  ├── #tocModal          — Modale table des matières (overlay)
  ├── .navbar            — Barre de navigation (logo + boutons)
  ├── #uploadSection     — Zone d'upload
  │     ├── Drop zone (drag & drop)
  │     ├── #browseBtn + #fileInput     — Sélection fichier
  │     └── #uploadLoading             — Spinner OCR en cours
  └── #workspaceSection  — Espace de travail (caché jusqu'au chargement OCR)
        ├── .panels
        │     ├── .panel (Source — PDF/image) → #pdfCanvas / #imgPreview
        │     └── .panel (Output — éditeur)
        │           ├── .toolbar  (H1/H2/H3/P, B/I, highlight, TOC, Couper fin, Export)
        │           └── #editor   (contenteditable)
        └── .page-nav    — Navigation Prev/Next/Page input

<script src="app.js">
```

### Bibliothèques chargées (CDN)

| Lib | Version | Rôle |
|---|---|---|
| PDF.js | 3.11.174 | Rendu PDF page par page dans `<canvas>` |
| html-docx-js | 0.3.1 | Conversion HTML → DOCX côté client |
| marked.js | 9.x | Rendu Markdown → HTML |

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
- `isRef` : `/^[ \t]*[\(\[]?\p{Nd}{1,2}[\)\].]\s/u` — référence numérotée (max 2 chiffres)
- Coupe si : pas de ligne après, ou première ligne après = `isRef`, ou ≤ 30 lignes après
- **Garde de 30%** : ne coupe que si le corps avant le séparateur représente ≥ 30% du contenu (évite faux positifs sur les pages TOC)

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
  ├── saveCurrentPage() uniquement si idx !== currentPage
  ├── renderPdfPage(idx+1) — PDF.js rendu canvas
  └── editor.innerHTML = marked.parse(pg.markdown) si page non encore éditée
```

> **Note** : La condition `idx !== currentPage` évite de capturer le placeholder HTML de l'éditeur vide lors de l'initialisation (page 1).

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

### Points de design

- Palette : bleu `#3B82F6` (accent), gris `#1F2937` (texte), fond `#F0F6FF`
- Font : **Inter** (Google Fonts) avec fallback system-ui
- `body { overflow: hidden }` — workspace couvre exactement `100vh - 52px`, overridé en responsive

---

## 8. Bibliothèques externes

### PDF.js (Mozilla) — v3.11.174
- **Usage** : rendu du PDF source page par page dans un `<canvas>`
- **Worker** : `pdf.worker.min.js` chargé depuis cdnjs
- **Scale** : calculé dynamiquement selon la largeur du panneau source (max 2.5×)

### marked.js — v9.x
- **Usage** : conversion `pg.markdown` → HTML affiché dans `#editor`
- Appelé à chaque `navigateTo()` si la page n'a pas encore été rendue

### html-docx-js — v0.3.1
- **Usage** : `htmlDocx.asBlob(htmlString)` → `Blob` DOCX téléchargeable
- CSS embarqué contrôle la typographie Word (Calibri 11pt)
- Les `<hr>` sont supprimés avant export (évitent des lignes VML dans Word)

---

## 9. Algorithmes clés

### Détection de séparateur de notes de bas de page

```
Problème : Mistral OCR rend les notes de bas de page dans le flux du texte,
           précédées d'une ligne de séparation horizontale.

Signal   : ligne composée uniquement de tirets/underscores/box-drawing chars
           IMMÉDIATEMENT suivie d'une référence numérotée (1), ١., [1]…

Stratégie: scan à rebours (dernier séparateur = séparateur de note)
           → coupe à cet endroit, conserve le corps

Garde    : ne coupe que si le corps avant le séparateur représente ≥ 30% du contenu
           (évite de supprimer les pages TOC où toutes les entrées ressemblent à des refs)

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

## 10. Raccourcis clavier

| Raccourci | Action |
|---|---|
| `PageUp` | Page précédente |
| `PageDown` | Page suivante |
| `Alt + ←` | Page précédente |
| `Alt + →` | Page suivante |
| `Entrée` (dans le champ page) | Aller à la page saisie |
| `Échap` (dans le champ page) | Annuler et restaurer le numéro actuel |

---

## 11. Limitations connues

| Limitation | Explication |
|---|---|
| Taille max 50 MB | Limite côté client (FileReader + base64 overhead) |
| Pas de persistance des éditions | Les modifications sont perdues si la page est rechargée |
| Notes de bas de page multilignes | Seules les lignes commençant par une référence numérotée sont supprimées |
| Étoiles décoratives arabes `* * *` | Non supprimées (comportement voulu — marqueurs de passage) |
| Export DOCX RTL | Le sens du texte arabe/hébreu peut nécessiter un ajustement manuel dans Word |
| Clé API en clair | Stockée en `localStorage` — ne pas utiliser sur un poste partagé |
| Mise en page | L'OCR retourne du texte brut sans positionnement exact — la mise en page originale n'est pas conservée |

---

# mistral-ocr
