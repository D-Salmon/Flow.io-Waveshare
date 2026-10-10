"""Decode the generated Wi-Fi QR and check upload-only artifact creation.

QA dependencies: requirements-flash.txt plus pillow and zxing-cpp.
"""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import zxingcpp

SCRIPT = Path(__file__).resolve().parents[1] / "capture_rescue_credentials.py"
SPEC = importlib.util.spec_from_file_location("rescue_credentials", SCRIPT)
CAPTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAPTURE)


class RescueWifiQrTest(unittest.TestCase):
    def test_decoded_credentials_and_override_directory(self):
        ssid = 'flow.io;test:é,"\\'
        password = 'p;ass:word,"\\'
        expected = 'WIFI:T:WPA;S:flow.io\\;test\\:é\\,\\"\\\\;P:p\\;ass\\:word\\,\\"\\\\;;'
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "local_rescue"
            with patch.dict(os.environ, {"FLOWIO_LOCAL_DEVICE_DIR": str(destination)}):
                CAPTURE._write_access_file(directory, ssid, password, "test flash")
            result = zxingcpp.read_barcode(Image.open(destination / "rescue-wifi.png"))
            self.assertIsNotNone(result)
            self.assertEqual(result.text, expected)
            access = (destination / "rescue-access.txt").read_text(encoding="utf-8")
            self.assertIn(ssid, access)
            self.assertIn(password, access)
            self.assertIn("rescue-wifi.png", access)
            self.assertFalse(list(destination.glob("*.tmp")))
            self.assertFalse((Path(directory) / "local-device").exists())

    def test_only_upload_hooks_generate_artifacts(self):
        class Environment:
            def __init__(self):
                self.actions = []

            def AddPreAction(self, target, action):
                self.actions.append(("pre", target, action.__name__))

            def AddPostAction(self, target, action):
                self.actions.append(("post", target, action.__name__))

        environment = Environment()
        namespace = {"__name__": "pio_extra_script", "env": environment, "Import": lambda _: None}
        exec(compile(SCRIPT.read_text(encoding="utf-8"), str(SCRIPT), "exec"), namespace)
        self.assertEqual(environment.actions, [
            ("pre", "upload", "_prepare_capture"),
            ("post", "upload", "_capture_rescue_credentials"),
            ("pre", "uploadfs", "_prepare_capture"),
            ("post", "uploadfs", "_capture_rescue_credentials"),
        ])


if __name__ == "__main__":
    unittest.main()
