"""
Diagnostic OCRLearning — reproduit exactement le pipeline de l'app web.
Usage : python test_ocr.py  (la clé API est demandée si absente de l'env)
"""
import base64, re, sys, os, json, urllib.request

PDF_PATH = r"C:\Mes Projets\Brouillon\AL AKHLAQ\SOMMAIRE AL AKHLAQ.pdf"
API_URL  = "https://api.mistral.ai/v1/ocr"
MODEL    = "mistral-ocr-latest"

# ── 1. Clé API ────────────────────────────────────────────────────────────────
api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
if not api_key:
    api_key = input("Mistral API key : ").strip()

# ── 2. Lecture PDF → DataURI ──────────────────────────────────────────────────
with open(PDF_PATH, "rb") as f:
    b64 = base64.b64encode(f.read()).decode()
data_uri = "data:application/pdf;base64," + b64
print(f"PDF chargé ({len(b64)//1024} KB base64)\n")

# ── 3. Appel API Mistral OCR ──────────────────────────────────────────────────
payload = json.dumps({
    "model": MODEL,
    "document": {"type": "document_url", "document_url": data_uri},
    "extract_header": True,
    "extract_footer": True,
}).encode()

req = urllib.request.Request(
    API_URL,
    data=payload,
    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    method="POST",
)
print("Appel Mistral OCR en cours...")
with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())

pages_raw = result.get("pages", [])
print(f"Pages retournees par l'API : {len(pages_raw)}\n")

# ── 4. Helpers nettoyage (traduction du JS) ───────────────────────────────────
DIGITS = r'[\u0030-\u0039\u0660-\u0669\u06F0-\u06F9]'

def is_sep(line):
    t = re.sub(r'[\s\u00A0\u200B]+', '', line.strip())
    return len(t) >= 2 and bool(re.fullmatch(r'[-\u2014\u2013\u2015_\u2500-\u257F\u2501\u2550]+', t))

def is_ref(line):
    return bool(re.match(r'^[ \t]*[\(\[]?' + DIGITS + r'+[\)\].]\s', line))

def clean_page_numbers(md):
    if not md:
        return ''
    r = re.sub(r'\r\n?', '\n', md)
    r = re.sub(r'<!--[\s\S]*?-->', '', r)
    r = re.sub(r'^\[page[^\]]*\][ \t]*$', '', r, flags=re.MULTILINE|re.IGNORECASE)
    # digits alone on a line
    r = re.sub(r'^[ \t]*' + DIGITS + r'+[ \t]*$', '', r, flags=re.MULTILINE)
    # fraction N/M
    r = re.sub(r'^[ \t]*' + DIGITS + r'+\s*/\s*' + DIGITS + r'+[ \t]*$', '', r, flags=re.MULTILINE)
    r = re.sub(r'\n{3,}', '\n\n', r)
    r = r.strip()

    lines = r.split('\n')
    cut_at = -1
    for i in range(len(lines)-1, -1, -1):
        if not is_sep(lines[i]):
            continue
        after = [l for l in lines[i+1:] if l.strip()]
        if len(after) == 0 or (after and is_ref(after[0])) or len(after) <= 30:
            cut_at = i
        break

    if cut_at < 0:
        foot_start = -1
        for i in range(len(lines)-1, -1, -1):
            line = lines[i].strip()
            if not line:
                continue
            if is_ref(line):
                foot_start = i
            else:
                break
        if foot_start >= 0:
            cut_at = foot_start

    if cut_at >= 0:
        r = '\n'.join(lines[:cut_at])
        r = re.sub(r'\n{3,}', '\n\n', r).strip()

    r = re.sub(r'^[-\u2014\u2013_\u2500-\u257F]{2,}[ \t]*$', '', r, flags=re.MULTILINE)
    r = re.sub(r'\n{3,}', '\n\n', r).strip()
    return r

# ── 5. Affichage page par page ────────────────────────────────────────────────
for i, pg in enumerate(pages_raw):
    raw_md  = pg.get("markdown", "") or ""
    hdr = pg.get("header", "") or ""
    ftr = pg.get("footer", "") or ""
    if isinstance(hdr, dict): hdr = hdr.get("text") or hdr.get("markdown") or ""
    if isinstance(ftr, dict): ftr = ftr.get("text") or ftr.get("markdown") or ""

    cleaned = clean_page_numbers(raw_md)

    sep = "=" * 60
    print(sep)
    print(f" PAGE {i+1}")
    print(sep)
    print(f"[RAW — {len(raw_md)} chars]")
    print((raw_md[:600]) or "(VIDE)")
    print()
    print(f"[APRES nettoyage — {len(cleaned)} chars]")
    print((cleaned[:600]) or "(VIDE apres nettoyage)")
    if hdr: print(f"\n[HEADER]: {hdr[:120]}")
    if ftr: print(f"[FOOTER]: {ftr[:120]}")
    print()

# ── 6. Sauvegarde ─────────────────────────────────────────────────────────────
out = r"C:\Mes Projets\Mistral OCR\ocr_raw_result.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(f"Resultat brut sauvegarde dans {out}")
