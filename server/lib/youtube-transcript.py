import json
import sys
import re

# Ensure UTF-8 output on Windows
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def extract_video_id(url_or_id):
    s = str(url_or_id).strip()
    match = re.search(r'(?:v=|\/embed\/|\/watch\?v=|youtu\.be\/|\/v\/|\/e\/|watch\?.*v=)([a-zA-Z0-9_-]{11})', s)
    if match:
        return match.group(1)
    if re.match(r'^[a-zA-Z0-9_-]{11}$', s):
        return s
    return None

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL or video ID provided."}))
        return

    target = sys.argv[1]
    vid = extract_video_id(target)
    if not vid:
        print(json.dumps({"error": f"Could not determine YouTube video ID from '{target}'"}))
        return

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        yta = YouTubeTranscriptApi()
        
        # In newer versions, yta.fetch(vid) or yta.list(vid)
        snippets = None
        try:
            snippets = yta.fetch(vid)
        except Exception:
            try:
                transcript_list = yta.list(vid)
                transcript = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
                snippets = transcript.fetch()
            except Exception:
                pass

        if snippets is None:
            # Fallback to classmethod if available
            try:
                snippets = YouTubeTranscriptApi.get_transcript(vid)
            except Exception as e:
                print(json.dumps({"ok": False, "videoId": vid, "error": f"Transcript not available: {str(e)}"}))
                return

        texts = []
        timestamps = []
        last_time = -120

        for item in snippets:
            text = getattr(item, 'text', None) or (item.get('text') if isinstance(item, dict) else str(item))
            start = getattr(item, 'start', None) if getattr(item, 'start', None) is not None else (item.get('start', 0) if isinstance(item, dict) else 0)
            
            clean_text = str(text or '').strip()
            if clean_text:
                texts.append(clean_text)
                if float(start) - float(last_time) >= 60:
                    mins = int(float(start) // 60)
                    secs = int(float(start) % 60)
                    time_str = f"{mins}:{secs:02d}"
                    timestamps.append({"time": time_str, "seconds": start, "text": clean_text})
                    last_time = start

        full_text = " ".join(texts)
        if not full_text.strip():
            print(json.dumps({"ok": False, "videoId": vid, "error": "Transcript was empty"}))
            return

        print(json.dumps({
            "ok": True,
            "videoId": vid,
            "text": full_text,
            "timestamps": timestamps[:25]
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"ok": False, "videoId": vid, "error": str(e)}))

if __name__ == "__main__":
    main()
