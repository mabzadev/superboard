import importlib.util
import json
import os
from pathlib import Path
from queue import Queue
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import unittest
from unittest.mock import patch


class ContainerCallbacksTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.received = Queue()

        class Gateway(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                cls.received.put((self.path, body, self.headers.get('X-VocoStar-Internal-Token')))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')

            def log_message(self, *_args):
                pass

        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Gateway)
        cls.server_thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        configuration = {
            'GATEWAY_URL': f'http://127.0.0.1:{cls.server.server_port}',
            'GATEWAY_INTERNAL_TOKEN': 'test-callback-token',
            'R2_ACCESS_KEY_ID': 'test-access',
            'R2_SECRET_ACCESS_KEY': 'test-secret',
            'R2_ENDPOINT_URL': 'https://r2.test',
            'R2_BUCKET_NAME': 'test-bucket',
            'FILES_INPUT_ORIGIN': 'https://files.test',
            'FILES_INPUT_MAX_BYTES': '1024',
            'OUTPUT_FILE_ORIGIN': 'https://output.test',
            'MODAL_ATS_URL': 'https://modal.test',
            'MODAL_TTS_URL': 'https://modal.test',
            'MODAL_API_KEY': 'test-modal-key',
            'WATERMARK_URL': 'https://output.test/watermark.png',
            'R2_READY_MAX_ATTEMPTS': '1',
        }
        cls.containers = {}
        with patch.dict(os.environ, configuration):
            for kind in ('medias', 'vocals'):
                path = Path(__file__).parent / kind / 'container' / 'main.py'
                spec = importlib.util.spec_from_file_location(f'{kind}_container', path)
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                cls.containers[kind] = module

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.server_thread.join()

    def run_modal(self, kind, scope):
        module = self.containers[kind]
        payload = {
            'user_id': 'legacy-user',
            'media_id': 'media-1',
            'user_vocal_id': 'vocal-1',
            'media_type': 'audio',
            'vocal_ref': 'https://output.test/reference.mp3',
            'audio_src': 'https://output.test/source.mp3',
            'text_audio': 'Audio preview',
            'text_unlock': 'Unlocked audio',
            **scope,
        }
        provider = 'call_modal' if kind == 'medias' else 'call_modal_tts'
        with (
            patch.object(module, provider, return_value={}),
            patch.object(module, 'wait_for_r2_object'),
            patch.object(module, 'heartbeat_response', side_effect=lambda worker: worker()),
        ):
            response = module.app.test_client().post('/run-modal', json={
                'queue_id': 'historical-queue-id',
                'payload': payload,
                'audio_src_url': 'https://output.test/source.mp3',
                'crv_r2_path': 'converted.mp3',
            })
        self.assertEqual(response.status_code, 200)
        return sorted([self.received.get(timeout=5), self.received.get(timeout=5)], key=lambda item: item[1]['progress'])

    def test_scoped_job_progress_reaches_its_gateway_with_its_identity(self):
        for kind, entity in [('medias', {'media_id': 'media-1'}), ('vocals', {'vocal_id': 'vocal-1'})]:
            with self.subTest(kind=kind):
                scope = {'project_ref': 'project-vocostar', 'job_id': 'job-1', 'subject': 'oidc-subject'}
                callbacks = self.run_modal(kind, scope)
                for callback, progress in zip(callbacks, [0.6, 0.9]):
                    self.assertEqual(callback, (
                        f'/ws/{kind}/progress',
                        {**entity, 'user_id': 'legacy-user', 'progress': progress, **scope},
                        'test-callback-token',
                    ))

    def test_legacy_job_does_not_invent_a_project_or_registered_job(self):
        for kind, entity in [('medias', {'media_id': 'media-1'}), ('vocals', {'vocal_id': 'vocal-1'})]:
            with self.subTest(kind=kind):
                for callback, progress in zip(self.run_modal(kind, {}), [0.6, 0.9]):
                    self.assertEqual(callback, (
                        f'/ws/{kind}/progress',
                        {**entity, 'user_id': 'legacy-user', 'progress': progress},
                        'test-callback-token',
                    ))


if __name__ == '__main__':
    unittest.main()
