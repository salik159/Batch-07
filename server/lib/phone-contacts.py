"""
NeuraOS Phone Link Contact Extractor & Searcher
Searches contacts.db synced by Windows Phone Link from iPhone (PBAP).
"""
import sys, os, glob, sqlite3, json, re, difflib

# Force UTF-8 stdout
import io
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def find_contacts_db():
    pattern = os.path.expandvars(r'%LOCALAPPDATA%\Packages\Microsoft.YourPhone_8wekyb3d8bbwe\LocalCache\Indexed\*\System\Database\contacts.db')
    matches = glob.glob(pattern)
    return matches[0] if matches else None

def normalize(text):
    return re.sub(r'[^a-z0-9]', '', (text or '').lower())

def search_contacts(query=""):
    db_path = find_contacts_db()
    if not db_path or not os.path.exists(db_path):
        return {"ok": False, "error": "Phone Link contacts database not found.", "matches": []}

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.cursor()
        cur.execute("""
            SELECT c.contact_id, c.display_name, p.phone_number, p.display_phone_number
            FROM contact c
            JOIN phonenumber p ON c.contact_id = p.contact_id
            WHERE c.display_name IS NOT NULL AND TRIM(c.display_name) != ''
        """)
        rows = cur.fetchall()
        conn.close()
    except Exception as e:
        return {"ok": False, "error": f"Database read error: {str(e)}", "matches": []}

    q = (query or "").strip()
    if not q:
        # return all unique contacts
        unique = []
        seen = set()
        for cid, name, num, dnum in rows:
            key = (name.lower(), num)
            if key not in seen:
                seen.add(key)
                unique.append({"name": name, "phoneNumber": num, "displayPhoneNumber": dnum or num})
        return {"ok": True, "matches": unique[:50]}

    q_norm = normalize(q)
    # Significant search words (> 1 character)
    words = [normalize(w) for w in re.split(r'[^a-zA-Z0-9]+', q) if len(w) > 1]
    
    candidates = []
    seen = set()

    for cid, name, num, dnum in rows:
        key = (name.lower(), num)
        if key in seen:
            continue
        seen.add(key)

        n_norm = normalize(name)
        n_words = [normalize(w) for w in re.split(r'[^a-zA-Z0-9]+', name) if len(w) > 1]

        score = 0.0

        # Exact match
        if q_norm == n_norm:
            score = 1.0
        else:
            ratio = difflib.SequenceMatcher(None, q_norm, n_norm).ratio()
            # Substring match (e.g. "Krishna" in "MG.krishna vardhan")
            if q_norm in n_norm or n_norm in q_norm:
                score = max(score, 0.85)
            
            # Token overlap
            if words:
                matched_count = 0
                for w in words:
                    if any(w == nw or w in nw or difflib.SequenceMatcher(None, w, nw).ratio() > 0.82 for nw in n_words):
                        matched_count += 1
                token_ratio = matched_count / len(words)
                score = max(score, token_ratio * 0.95, ratio)
            else:
                score = max(score, ratio)

        if score >= 0.65:
            candidates.append({
                "name": name,
                "phoneNumber": num,
                "displayPhoneNumber": dnum or num,
                "score": round(score, 3)
            })

    # Sort descending by score
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return {"ok": True, "query": q, "matches": candidates}

if __name__ == "__main__":
    q_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    res = search_contacts(q_arg)
    print(json.dumps(res, ensure_ascii=False))
