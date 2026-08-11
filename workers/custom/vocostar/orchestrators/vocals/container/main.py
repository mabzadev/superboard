# BUILD: 2026-04-21 v5 — conversion audio ref m4a→mp3 avant Modal
import os
import threading
import json
import time
import tempfile
import subprocess
import requests
import boto3
from urllib.parse import urlsplit
from botocore.config import Config

from flask import Flask, request as flask_request, Response as FlaskResponse
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__)

# ── Configuration injectée par le Worker / GitHub Environment ────────────────
def required_env(name: str) -> str:
  value = os.environ.get(name, "").strip()
  if not value:
    raise RuntimeError(f"Missing required environment variable: {name}")
  return value

MODAL_TTS_URL         = required_env("MODAL_TTS_URL")
MODAL_API_KEY         = required_env("MODAL_API_KEY")
FILES_INPUT_ORIGIN    = required_env("FILES_INPUT_ORIGIN").rstrip("/")
FILES_INPUT_MAX_BYTES = int(required_env("FILES_INPUT_MAX_BYTES"))
OUTPUT_BASE_URL       = required_env("OUTPUT_FILE_ORIGIN").rstrip("/")
GATEWAY_URL           = required_env("GATEWAY_URL").rstrip("/")
GATEWAY_INTERNAL_TOKEN = required_env("GATEWAY_INTERNAL_TOKEN")
R2_ACCESS_KEY_ID      = required_env("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY  = required_env("R2_SECRET_ACCESS_KEY")
R2_ENDPOINT_URL       = required_env("R2_ENDPOINT_URL")
R2_BUCKET_NAME        = required_env("R2_BUCKET_NAME")
R2_READY_MAX_ATTEMPTS = int(required_env("R2_READY_MAX_ATTEMPTS"))

if not 1 <= FILES_INPUT_MAX_BYTES <= 100 * 1024 * 1024:
  raise RuntimeError("FILES_INPUT_MAX_BYTES must be between 1 byte and 100 MiB")


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_r2_client():
  return boto3.client(
    service_name='s3',
    endpoint_url=R2_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    region_name='auto',
    config=Config(s3={'addressing_style': 'path'}),
  )

def get_r2_key(url: str) -> str | None:
  if not isinstance(url, str):
    return None
  parsed = urlsplit(url)
  origin = f"{parsed.scheme}://{parsed.netloc}"
  if origin == OUTPUT_BASE_URL and not parsed.query and not parsed.fragment:
    return parsed.path.lstrip('/')
  return None

def is_files_ticket_url(url: str) -> bool:
  if not isinstance(url, str):
    return False
  parsed = urlsplit(url)
  origin = f"{parsed.scheme}://{parsed.netloc}"
  ticket = parsed.path.removeprefix('/v1/downloads/')
  return (
    origin == FILES_INPUT_ORIGIN
    and parsed.path.startswith('/v1/downloads/')
    and 1 <= len(ticket) <= 2048
    and not parsed.query
    and not parsed.fragment
  )

def require_source_url(url: str, label: str) -> None:
  if get_r2_key(url) or is_files_ticket_url(url):
    return
  raise ValueError(f"Unsupported {label} origin")

def download_from_r2(r2_key: str, dest_path: str, label: str = "file") -> None:
  print(f"[R2↓] Downloading {label}...")
  t = time.time()
  with open(dest_path, 'wb') as f:
    get_r2_client().download_fileobj(R2_BUCKET_NAME, r2_key, f)
  print(f"[R2↓] {label} done in {time.time()-t:.2f}s")

def upload_to_r2(local_path: str, remote_key: str, content_type: str) -> str:
  clean = remote_key.lstrip('/')
  with open(local_path, 'rb') as f:
    get_r2_client().upload_fileobj(f, R2_BUCKET_NAME, clean, ExtraArgs={'ContentType': content_type})
  return f"{OUTPUT_BASE_URL}/{clean}"

def wait_for_r2_object(r2_key: str, poll_interval: int = 5) -> None:
  """
  Polling direct R2 via boto3 head_object (zéro CDN).
  Attend au maximum R2_READY_MAX_ATTEMPTS avant d'échouer explicitement.
  """
  client  = get_r2_client()
  print(f"[WAIT_R2] Polling direct R2 : {r2_key}")
  for attempt in range(1, R2_READY_MAX_ATTEMPTS + 1):
    try:
      resp = client.head_object(Bucket=R2_BUCKET_NAME, Key=r2_key)
      size = resp.get('ContentLength', 0)
      if size > 0:
        print(f"[WAIT_R2] ✅ Prêt après {attempt} tentatives ({size} bytes)")
        return
      print(f"[WAIT_R2] Objet vide (attempt {attempt}), retry dans {poll_interval}s...")
    except Exception as e:
      print(f"[WAIT_R2] Pas encore disponible (attempt {attempt}): {e}")
    if attempt < R2_READY_MAX_ATTEMPTS:
      time.sleep(poll_interval)
  raise TimeoutError(
    f"R2 object unavailable after {R2_READY_MAX_ATTEMPTS} attempts: {r2_key}"
  )

def convert_audio_ref(audio_src_url: str, user_id: str) -> str:
  """
  Convertit la référence vocale de .m4a (uploads/) vers .mp3 (audios/).
  Entrée  : ${OUTPUT_FILE_ORIGIN}/users/{id}/uploads/audio_xxx.m4a
  Sortie  : ${OUTPUT_FILE_ORIGIN}/users/{id}/audios/audio_xxx.mp3
  Si l'URL n'est pas .m4a, retourne l'URL inchangée.
  """
  r2_key = get_r2_key(audio_src_url)
  if not r2_key or not r2_key.lower().endswith('.m4a'):
    print(f"[CONVERT] Skip (non-m4a) : {audio_src_url[-60:]}")
    return audio_src_url

  filename = os.path.basename(r2_key)                 # audio_xxx.m4a
  stem     = os.path.splitext(filename)[0]             # audio_xxx
  out_key  = f"users/{user_id}/audios/{stem}.mp3"
  out_url  = f"{OUTPUT_BASE_URL}/{out_key}"

  with tempfile.TemporaryDirectory() as tmp:
    in_path  = os.path.join(tmp, filename)
    out_path = os.path.join(tmp, f"{stem}.mp3")

    download_from_r2(r2_key, in_path, "audio_ref_m4a")

    t = time.time()
    subprocess.run(
      ['ffmpeg', '-y', '-i', in_path, '-acodec', 'libmp3lame', '-q:a', '2', out_path],
      check=True, capture_output=True,
    )
    print(f"[CONVERT] ffmpeg done in {time.time()-t:.2f}s")

    upload_to_r2(out_path, out_key, 'audio/mpeg')
    print(f"[CONVERT] ✅ {audio_src_url[-40:]} → {out_url[-40:]}")
    return out_url

def update_vocal_progress(vocal_id: str, user_id: str, progress: float):
  """Met à jour progress dans D1 + notifie la UserVocalsRoom via l'auth-gateway."""
  try:
    resp = requests.post(
      f"{GATEWAY_URL}/ws/vocals/progress",
      json={"vocal_id": vocal_id, "user_id": user_id, "progress": progress},
      headers={"X-VocoStar-Internal-Token": GATEWAY_INTERNAL_TOKEN},
      timeout=10,
    )
    resp.raise_for_status()
    print(f"[PROGRESS] {vocal_id[:8]}.. → {progress} (D1+WS via gateway)")
  except Exception as e:
    print(f"[PROGRESS] ERR: {e}")



def call_modal_tts(text: str, language: str, prompt_wav_url: str, r2_path: str, timeout: int = 300) -> dict:
  """Appelle Modal Chatterbox TTS."""
  url  = MODAL_TTS_URL.rstrip("/") + "/chatterbox"
  body = {
    "api_key":        MODAL_API_KEY,
    "text":           text,
    "language":       language,
    "prompt_wav_url": prompt_wav_url,
    "r2_path":        r2_path,
  }
  print(f"[Modal TTS] POST {url} | r2={r2_path}")
  r = requests.post(url, json=body, headers={"Content-Type": "application/json"}, timeout=timeout)
  r.raise_for_status()
  data = r.json()
  print(f"[Modal TTS] OK: {str(data)[:120]}")
  return data


def heartbeat_response(worker_fn, *args, **kwargs):
  """
  Exécute worker_fn en background.
  Stream des bytes de heartbeat (1 octet/5s) pour éviter le timeout TCP idle CF.
  """
  holder = {'result': None, 'error': None, 'done': False}

  def _run():
    try:
      holder['result'] = worker_fn(*args, **kwargs)
    except Exception as e:
      holder['error'] = str(e)
      print(f"[heartbeat_response] ERROR: {e}")
    finally:
      holder['done'] = True

  threading.Thread(target=_run, daemon=True).start()

  def _stream():
    while not holder['done']:
      yield b' '
      time.sleep(5)
    if holder['error']:
      yield json.dumps({'status': 'failed', 'error': holder['error']}).encode()
    else:
      yield json.dumps({'status': 'completed', **holder['result']}).encode()

  return FlaskResponse(_stream(), status=200, mimetype='application/octet-stream')


# ── Shutdown dynamique ──────────────────────────────────────────────────────────
def _schedule_shutdown(delay: float = 2.0):
  import signal as _sig
  def _kill():
    print(f"[SHUTDOWN] SIGTERM → PID 1 (delay={delay}s)")
    try:
      os.kill(1, _sig.SIGTERM)
    except Exception as e:
      print(f"[SHUTDOWN] SIGTERM failed: {e}")
    time.sleep(3)
    print("[SHUTDOWN] Fallback os._exit(0)")
    os._exit(0)
  threading.Timer(delay, _kill).start()
  print(f"[SHUTDOWN] Timer démarré : arrêt dans {delay}s")


# ── Flask routes ───────────────────────────────────────────────────────────────

@app.route("/", methods=["GET"])
def health():
  return {"status": "ok", "version": "v4-vocals-d1"}, 200


@app.route("/shutdown", methods=["POST"])
def shutdown():
  """Step final : le Workflow appelle cet endpoint après release-slot pour tuer le container."""
  _schedule_shutdown(2.0)
  return {"status": "shutting_down"}, 200


@app.route("/run-modal", methods=["POST"])
def run_modal():
  """
  Step 2 : Génère 2 fichiers audio TTS (text_audio + text_unlock) en parallèle.
  Réponse streaming avec heartbeat (2–5 min).
  Met à jour progress 0.6 (avant) et 0.9 (après) dans D1 + notifie WS.
  NE fait PAS la mise à jour finale users_vocals — le Workflow s'en charge.
  Retourne : {audio_audio_url, audio_unlock_url, refs_url}
  """
  body      = flask_request.get_json(silent=True) or {}
  payload   = body.get('payload', {})

  user_vocal_id = payload.get("user_vocal_id")
  user_id       = payload.get("user_id")
  audio_src     = payload.get("audio_src")
  language      = payload.get("language") or "en"
  text_audio    = payload.get("text_audio")
  text_unlock   = payload.get("text_unlock")

  if not all([user_vocal_id, user_id, audio_src, text_audio, text_unlock]):
    return {"error": f"Missing required fields: {payload}"}, 400

  def _worker():
    require_source_url(audio_src, "audio source")
    import datetime
    timestamp  = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    prefix     = f"vs_{user_vocal_id}_{timestamp}"
    r2_audio   = f"users/{user_id}/audios/{prefix}_audio.mp3"
    r2_unlock  = f"users/{user_id}/audios/{prefix}_unlock.mp3"
    refs_url   = convert_audio_ref(audio_src, user_id)  # .m4a → .mp3 si nécessaire

    # Progress 0.6 avant Modal (background — non-bloquant)
    threading.Thread(
      target=update_vocal_progress,
      args=(user_vocal_id, user_id, 0.6),
      daemon=True,
    ).start()

    # 2 jobs TTS en parallèle — utilise refs_url (mp3 converti) comme prompt vocal
    def _run_audio():  return call_modal_tts(text_audio,  language, refs_url, r2_audio)
    def _run_unlock(): return call_modal_tts(text_unlock, language, refs_url, r2_unlock)

    with ThreadPoolExecutor(max_workers=2) as ex:
      f_audio  = ex.submit(_run_audio)
      f_unlock = ex.submit(_run_unlock)
      res_audio  = f_audio.result()
      res_unlock = f_unlock.result()

    audio_audio_url  = res_audio.get("audio_crv_url")  or f"{OUTPUT_BASE_URL}/{r2_audio}"
    audio_unlock_url = res_unlock.get("audio_crv_url") or f"{OUTPUT_BASE_URL}/{r2_unlock}"

    # ── Confirme que les 2 fichiers sont bien dans R2 avant de rendre la main ──
    for url, label in [(audio_audio_url, "audio_audio"), (audio_unlock_url, "audio_unlock")]:
      key = get_r2_key(url)
      if not key:
        raise ValueError(f"{label} is outside the configured output origin")
      wait_for_r2_object(key, poll_interval=5)

    # Progress 0.9 après Modal + confirmation R2 (background)
    threading.Thread(
      target=update_vocal_progress,
      args=(user_vocal_id, user_id, 0.9),
      daemon=True,
    ).start()

    return {
      "audio_audio_url":  audio_audio_url,
      "audio_unlock_url": audio_unlock_url,
      "refs_url":         refs_url,
    }

  return heartbeat_response(_worker)


if __name__ == "__main__":
  port = int(os.environ.get("PORT", 8080))
  print(f"[Flask] Vocals container v4 starting on port {port}")
  app.run(host="0.0.0.0", port=port, threaded=False)
