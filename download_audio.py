"""Download all 1000 WSA audio clips from Google Drive into audio/."""
import json, os, sys, time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(HERE, 'audio')
os.makedirs(AUDIO, exist_ok=True)
links = json.load(open(os.path.join(HERE, 'audio_links.json')))

def is_audio(path):
    try:
        with open(path, 'rb') as f:
            head = f.read(3)
        return head in (b'ID3', b'\xff\xfb', b'\xff\xf3') or head[:2] == b'\xff\xfb'
    except OSError:
        return False

def fetch(name, fid):
    dest = os.path.join(AUDIO, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 2000 and is_audio(dest):
        return name, 'cached'
    url = f'https://drive.google.com/uc?export=download&id={fid}'
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            if data[:3] == b'ID3' or data[:2] in (b'\xff\xfb', b'\xff\xf3'):
                with open(dest, 'wb') as f:
                    f.write(data)
                return name, 'ok'
            # HTML response = quota/permission page; back off and retry
            time.sleep(3 * (attempt + 1))
        except Exception:
            time.sleep(3 * (attempt + 1))
    return name, 'FAILED'

results = {'ok': 0, 'cached': 0, 'FAILED': 0}
failed = []
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(fetch, n, fid): n for n, fid in links.items()}
    done = 0
    for fut in as_completed(futs):
        name, status = fut.result()
        results[status] += 1
        if status == 'FAILED':
            failed.append(name)
        done += 1
        if done % 100 == 0:
            print(f'{done}/1000 …', flush=True)

print('RESULTS:', results)
if failed:
    print('FAILED FILES:', failed[:20])
    json.dump(failed, open(os.path.join(HERE, 'audio_failed.json'), 'w'))
sys.exit(1 if failed else 0)
