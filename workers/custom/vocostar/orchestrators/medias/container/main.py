# BUILD: 2026-04-21 v5 — wait_for_r2_object (boto3 polling) avant FFmpeg
# Container reste vivant via sleepAfter=10m (pas de _schedule_shutdown par route).
# Chaque step CF Workflow appelle un endpoint séparé et caché indépendamment.
import os
import threading
import tempfile
import datetime
import requests
import ffmpeg
import subprocess
import json
import time
from urllib.parse import urlsplit

from flask import Flask, request as flask_request, Response as FlaskResponse
import boto3
from botocore.config import Config
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)

# ── Configuration injectée par le Worker / GitHub Environment ────────────────
def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value

GATEWAY_URL            = required_env("GATEWAY_URL").rstrip("/")
GATEWAY_INTERNAL_TOKEN = required_env("GATEWAY_INTERNAL_TOKEN")
R2_ACCESS_KEY_ID       = required_env("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY   = required_env("R2_SECRET_ACCESS_KEY")
R2_ENDPOINT_URL        = required_env("R2_ENDPOINT_URL")
R2_BUCKET_NAME         = required_env("R2_BUCKET_NAME")
FILES_INPUT_ORIGIN     = required_env("FILES_INPUT_ORIGIN").rstrip("/")
FILES_INPUT_MAX_BYTES  = int(required_env("FILES_INPUT_MAX_BYTES"))
OUTPUT_BASE_URL        = required_env("OUTPUT_FILE_ORIGIN").rstrip("/")
MODAL_ATS_URL          = required_env("MODAL_ATS_URL")
MODAL_TTS_URL          = required_env("MODAL_TTS_URL")
MODAL_API_KEY          = required_env("MODAL_API_KEY")
WATERMARK_URL          = required_env("WATERMARK_URL")
R2_READY_MAX_ATTEMPTS  = int(required_env("R2_READY_MAX_ATTEMPTS"))

if not 1 <= FILES_INPUT_MAX_BYTES <= 100 * 1024 * 1024:
    raise RuntimeError("FILES_INPUT_MAX_BYTES must be between 1 byte and 100 MiB")


# ── R2 helpers ─────────────────────────────────────────────────────────────────
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

def wait_for_r2_object(r2_key: str, poll_interval: int = 5) -> None:
    """
    Polling direct R2 via boto3 head_object (zéro CDN).
    Attend au maximum R2_READY_MAX_ATTEMPTS avant d'échouer explicitement.
    Appelé après run-modal pour garantir que audio_crv est prêt avant FFmpeg.
    """
    client   = get_r2_client()
    print(f"[WAIT_R2] Polling direct R2 : {r2_key}")
    for attempt in range(1, R2_READY_MAX_ATTEMPTS + 1):
        try:
            resp = client.head_object(Bucket=R2_BUCKET_NAME, Key=r2_key)
            size = resp.get('ContentLength', 0)
            if size > 0:
                print(f"[WAIT_R2] ✅ Objet prêt après {attempt} tentatives ({size} bytes)")
                return
            print(f"[WAIT_R2] Objet existe mais vide (attempt {attempt}), retry dans {poll_interval}s...")
        except Exception as e:
            print(f"[WAIT_R2] Pas encore disponible (attempt {attempt}): {e}")
        if attempt < R2_READY_MAX_ATTEMPTS:
            time.sleep(poll_interval)
    raise TimeoutError(
        f"R2 object unavailable after {R2_READY_MAX_ATTEMPTS} attempts: {r2_key}"
    )

def download_from_r2(r2_key: str, dest_path: str, label: str = "file", max_retries: int = 5):
    for attempt in range(1, max_retries + 1):
        try:
            print(f"[R2↓] {label} (attempt {attempt}/{max_retries})")
            t = time.time()
            with open(dest_path, 'wb') as f:
                get_r2_client().download_fileobj(R2_BUCKET_NAME, r2_key, f)
            print(f"[R2↓] {label} done in {time.time()-t:.2f}s")
            return
        except Exception as e:
            print(f"[R2↓] ERR {attempt}/{max_retries}: {e}")
            if attempt == max_retries:
                raise
            time.sleep(2 ** (attempt - 1))

def download_file(url: str, dest: str, label: str = "file"):
    key = get_r2_key(url)
    if key:
        download_from_r2(key, dest, label)
        return
    if not is_files_ticket_url(url):
        raise ValueError(f"Unsupported {label} origin")
    with requests.get(
        url,
        stream=True,
        timeout=(10, 60),
        allow_redirects=False,
    ) as response:
        if response.status_code not in (200, 206):
            raise RuntimeError(f"Files ticket download returned HTTP {response.status_code}")
        announced = int(response.headers.get('content-length', '0') or '0')
        if announced > FILES_INPUT_MAX_BYTES:
            raise ValueError(f"{label} exceeds configured byte limit")
        total = 0
        with open(dest, 'wb') as output:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > FILES_INPUT_MAX_BYTES:
                    raise ValueError(f"{label} exceeds configured byte limit")
                output.write(chunk)

def upload_to_r2(local_path: str, remote_path: str, content_type: str) -> str:
    if not os.path.exists(local_path):
        raise Exception(f"File missing: {local_path}")
    clean = remote_path.lstrip('/')
    with open(local_path, 'rb') as f:
        get_r2_client().upload_fileobj(f, R2_BUCKET_NAME, clean, ExtraArgs={'ContentType': content_type})
    return f"{OUTPUT_BASE_URL}/{clean}"

def upload_r2_parallel(uploads: list) -> dict:
    results = {}
    with ThreadPoolExecutor(max_workers=len(uploads)) as ex:
        futs = {ex.submit(upload_to_r2, u['local'], u['remote'], u['ct']): u['key'] for u in uploads}
        for f in as_completed(futs):
            results[futs[f]] = f.result()
    return results


# ── Modal helper ───────────────────────────────────────────────────────────────
def call_modal(modal_url: str, endpoint: str, payload: dict, timeout: int = 480) -> dict:
    url  = modal_url.rstrip("/") + "/" + endpoint.lstrip("/")
    body = {"api_key": MODAL_API_KEY, **payload}
    print(f"[Modal] POST {url}")
    r = requests.post(url, json=body, headers={"Content-Type": "application/json"}, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    print(f"[Modal] OK: {str(data)[:120]}")
    return data


# ── Gateway progress helper ───────────────────────────────────────────────────
def update_progress(table: str, row_id: str, user_id: str, progress: float):
    """Met à jour progress via API Gateway (appelé dans un thread background)."""
    try:
        if table == 'users_medias':
            endpoint = f"{GATEWAY_URL}/ws/medias/progress"
            payload  = {"media_id": row_id, "user_id": user_id, "progress": progress}
        else:
            endpoint = f"{GATEWAY_URL}/ws/vocals/progress"
            payload  = {"vocal_id": row_id, "user_id": user_id, "progress": progress}
        r = requests.post(
            endpoint,
            json=payload,
            headers={"X-VocoStar-Internal-Token": GATEWAY_INTERNAL_TOKEN},
            timeout=10,
        )
        r.raise_for_status()
        print(f"[PROGRESS] {table}/{row_id[:8]}.. → {progress} | HTTP {r.status_code}")
    except Exception as e:
        print(f"[PROGRESS] ERR: {e}")


# ── Heartbeat stream helper ────────────────────────────────────────────────────
def heartbeat_response(worker_fn, *args, **kwargs):
    """
    Exécute worker_fn(*args, **kwargs) en background.
    Stream des bytes de heartbeat (1 octet/5s) pour éviter le timeout TCP idle CF.
    Le Workflow lit le stream complet → extrait le dernier JSON (status + résultat).
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


# ── Shutdown dynamique ────────────────────────────────────────────────────────
def _schedule_shutdown(delay: float = 2.0):
    """
    Arrête le container `delay` secondes après l'appel.
    SIGTERM → PID 1 + fallback os._exit(0) si SIGTERM ignoré.
    """
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
    import threading as _th
    _th.Timer(delay, _kill).start()
    print(f"[SHUTDOWN] Timer démarré : arrêt dans {delay}s")


# ── Flask routes ───────────────────────────────────────────────────────────────

@app.route('/', methods=['GET'])
def health():
    return {'status': 'ok', 'version': 'v3-multi-step'}, 200


@app.route('/shutdown', methods=['POST'])
def shutdown():
    """Step final : le Workflow appelle cet endpoint après release-slot pour tuer le container."""
    _schedule_shutdown(2.0)
    return {'status': 'shutting_down'}, 200


@app.route('/prepare', methods=['POST'])
def prepare():
    """
    Step 2 : Download source + extract/normalize audio + upload audio_src vers R2.
    Réponse synchrone (< 60s) — pas de heartbeat nécessaire.
    Retourne : {audio_src_url, video_src_url, crv_r2_path, file_prefix, is_video}
    """
    body       = flask_request.get_json(silent=True) or {}
    payload    = body.get('payload', {})
    media_id   = payload.get('media_id')
    user_id    = payload.get('user_id')
    media_type = payload.get('media_type')
    video_src  = payload.get('video_src', '')
    audio_src  = payload.get('audio_src', '')

    if not all([media_id, user_id, media_type]):
        return {'error': 'Missing params (media_id, user_id, media_type)'}, 400

    timestamp   = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    file_prefix = f"vs_{media_id}_{timestamp}"
    crv_r2_path = f"users/{user_id}/audios/{file_prefix}_crv.mp3"
    is_video    = (media_type == 'video')

    # ── ZERO download / ZERO ffmpeg / ZERO upload ──────────────────────────────
    # Tous les fichiers sont déjà dans R2.
    # audio_src_url est passé directement à Modal → Modal télécharge lui-même via R2 API.
    # Pour la vidéo : Modal reçoit video_src comme source_url et extrait l'audio lui-même.

    if is_video:
        require_source_url(video_src, "video source")
        audio_src_url = video_src   # Modal lit la vidéo et en extrait l'audio
        video_src_url = video_src
    elif media_type == 'audio':
        require_source_url(audio_src, "audio source")
        audio_src_url = audio_src
        video_src_url = ""
    else:  # text
        audio_src_url = ""
        video_src_url = ""

    print(f"[prepare] ✅ 0s | prefix={file_prefix} | type={media_type} | src={audio_src_url[-50:]!r}")
    return {
        'audio_src_url': audio_src_url,
        'video_src_url': video_src_url,
        'crv_r2_path':   crv_r2_path,
        'file_prefix':   file_prefix,
        'is_video':      is_video,
    }, 200



@app.route('/run-modal', methods=['POST'])
def run_modal():
    """
    Step 3 : Appel Modal (SeedVC pour video/audio, Chatterbox pour text).
    Réponse streaming avec heartbeat (2–8 min).
    Si ce step échoue et retry : /prepare est caché → pas de re-download.
    Retourne : {audio_crv_url}
    """
    body          = flask_request.get_json(silent=True) or {}
    payload       = body.get('payload', {})
    audio_src_url = body.get('audio_src_url', '')
    crv_r2_path   = body.get('crv_r2_path', '')

    media_id   = payload.get('media_id')
    user_id    = payload.get('user_id', '')
    media_type = payload.get('media_type')
    vocal_ref  = payload.get('vocal_ref')

    def _worker():
        require_source_url(vocal_ref, "vocal reference")
        # Progress 0.6 avant Modal
        threading.Thread(
            target=update_progress, args=("users_medias", media_id, user_id, 0.6), daemon=True,
        ).start()

        if media_type in ('video', 'audio'):
            data = call_modal(
                MODAL_ATS_URL, "seed-vc",
                {"source_url": audio_src_url, "target_url": vocal_ref, "r2_path": crv_r2_path},
                timeout=480,
            )
        elif media_type == 'text':
            lang = payload.get('language') or payload.get('Language') or 'en'
            txt  = payload.get('text_src') or payload.get('text')
            data = call_modal(
                MODAL_TTS_URL, "chatterbox",
                {"text": txt, "language": lang, "prompt_wav_url": vocal_ref, "r2_path": crv_r2_path},
                timeout=480,
            )
        else:
            raise ValueError(f"Unknown media_type: {media_type}")

        audio_crv_url = data.get("audio_crv_url") or f"{OUTPUT_BASE_URL}/{crv_r2_path}"

        # ── Attend que audio_crv soit bien dans R2 avant de rendre la main à FFmpeg ──
        crv_key = get_r2_key(audio_crv_url)
        if not crv_key:
            raise ValueError("Modal output is outside the configured output origin")
        wait_for_r2_object(crv_key, poll_interval=5)

        # Progress 0.9 après Modal + confirmation R2
        threading.Thread(
            target=update_progress, args=("users_medias", media_id, user_id, 0.9), daemon=True,
        ).start()

        return {"audio_crv_url": audio_crv_url}

    return heartbeat_response(_worker)


@app.route('/run-ffmpeg', methods=['POST'])
def run_ffmpeg():
    """
    Step 4 : FFmpeg mux (vidéo seulement).
    Télécharge video + audio_crv depuis R2 en parallèle, mux, upload résultats en parallèle.
    Réponse streaming avec heartbeat (20–90s).
    Si ce step échoue et retry : prepare + run-modal sont cachés → on ne re-paye pas Modal.
    Retourne : {video_sd, video_hd, video_ads, thumbnail}
    """
    body          = flask_request.get_json(silent=True) or {}
    video_src_url = body.get('video_src_url', '')
    audio_crv_url = body.get('audio_crv_url', '')
    user_id       = body.get('user_id', '')
    file_prefix   = body.get('file_prefix', '')

    def _worker():
        with tempfile.TemporaryDirectory() as tmp:
            input_video     = os.path.join(tmp, "input.mp4")
            raw_flash_audio = os.path.join(tmp, "flash_audio.mp3")
            wat_path        = os.path.join(tmp, "wat.png")

            # Téléchargements en parallèle (video + audio_crv + watermark)
            t0 = time.time()
            def dl_video():      download_file(video_src_url, input_video, "video")
            def dl_audio():      download_from_r2(get_r2_key(audio_crv_url), raw_flash_audio, "audio_crv")
            def dl_watermark():  download_from_r2(get_r2_key(WATERMARK_URL), wat_path, "watermark")

            with ThreadPoolExecutor(max_workers=3) as ex:
                futs = [ex.submit(dl_video), ex.submit(dl_audio), ex.submit(dl_watermark)]
                for f in as_completed(futs):
                    f.result()  # lève l'exception si un download échoue
            print(f"[TIMING] FFmpeg downloads (parallel): {time.time()-t0:.2f}s")

            p_sd_wat = os.path.join(tmp, "sd_wat.mp4")
            p_sd     = os.path.join(tmp, "sd.mp4")
            p_hd     = os.path.join(tmp, "hd.mp4")
            p_thumb  = os.path.join(tmp, "thumb.jpg")
            pre_v    = f"users/{user_id}/videos/{file_prefix}"
            pre_i    = f"users/{user_id}/images/{file_prefix}"

            v_input  = ffmpeg.input(input_video)
            a_input  = ffmpeg.input(raw_flash_audio)
            v_stream = v_input.video
            a_stream = a_input.audio
            w_input  = ffmpeg.input(wat_path)
            w_op     = w_input.filter('colorchannelmixer', aa=0.5)
            v_wat    = v_stream.overlay(w_op, x='main_w-overlay_w-20', y='main_h-overlay_h-20')

            t1 = time.time()
            ffmpeg.merge_outputs(
                # SD + watermark — re-encode obligatoire (overlay filter)
                ffmpeg.output(v_wat,    a_stream, p_sd_wat, video_bitrate='800k', acodec='aac', preset='ultrafast', **{'threads': '0'}),
                # SD + HD sans watermark — copy vidéo (zéro re-encodage)
                ffmpeg.output(v_stream, a_stream, p_sd, acodec='aac', **{'c:v': 'copy'}),
                ffmpeg.output(v_stream, a_stream, p_hd, acodec='aac', **{'c:v': 'copy'}),
                # Thumbnail — 1 frame
                ffmpeg.output(v_stream, p_thumb, vframes=1, ss='00:00:01'),
            ).run(overwrite_output=True, capture_stdout=True, capture_stderr=True)
            print(f"[TIMING] FFmpeg mux: {time.time()-t1:.2f}s")

            # Upload finaux en parallèle
            t2 = time.time()
            parallel = upload_r2_parallel([
                {"local": p_sd,     "remote": f"{pre_v}_sd.mp4",     "ct": "video/mp4",  "key": "video_sd"},
                {"local": p_hd,     "remote": f"{pre_v}_hd.mp4",     "ct": "video/mp4",  "key": "video_hd"},
                {"local": p_thumb,  "remote": f"{pre_i}.jpg",         "ct": "image/jpeg", "key": "thumbnail"},
                {"local": p_sd_wat, "remote": f"{pre_v}_sd_wat.mp4",  "ct": "video/mp4",  "key": "video_ads"},
            ])
            print(f"[TIMING] R2 uploads (parallel): {time.time()-t2:.2f}s")

            return {
                "video_sd":  parallel["video_sd"],
                "video_hd":  parallel["video_hd"],
                "video_ads": parallel["video_ads"],
                "thumbnail": parallel["thumbnail"],
            }

    return heartbeat_response(_worker)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    CONTAINER_VERSION = "BUILD 2026-04-15 v3 — multi-step: /prepare /run-modal /run-ffmpeg"
    print(f"[Flask] Media container starting on port {port}")
    print(f"[Flask] {CONTAINER_VERSION}")
    app.run(host='0.0.0.0', port=port, threaded=True)
