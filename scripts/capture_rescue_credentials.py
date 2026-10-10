"""Capture Flow.io Rescue credentials from USB serial after firmware upload."""

from datetime import datetime
from pathlib import Path
import re
import os
import importlib.util
import subprocess
import sys
import time

try:
    Import("env")
except NameError:
    env = None


_CREDENTIALS_RE = re.compile(
    rb"\[FLOWIO_RESCUE_CREDENTIALS\]\s+ssid=([^\s]+)\s+password=([^\s]+)"
)


def _capture_from_port(upload_port, project_dir, reset_device=False):
    try:
        import serial
    except ImportError:
        print("[rescue-credentials] pyserial indisponible; fichier non créé")
        return

    upload_port = str(upload_port or "").strip()
    if not upload_port or upload_port.startswith("$"):
        print("[rescue-credentials] port série inconnu; fichier non créé")
        return

    deadline = time.monotonic() + 45.0
    serial_port = None
    match = None
    while time.monotonic() < deadline and match is None:
        if serial_port is None:
            try:
                serial_port = serial.Serial(upload_port, 115200, timeout=0.5)
                if reset_device:
                    serial_port.dtr = False
                    serial_port.rts = True
                    time.sleep(0.1)
                    serial_port.dtr = True
                    serial_port.rts = False
                    time.sleep(0.1)
                    serial_port.dtr = False
                    reset_device = False
            except (OSError, serial.SerialException):
                time.sleep(0.5)
                continue
        try:
            line = serial_port.readline()
        except (OSError, serial.SerialException):
            serial_port.close()
            serial_port = None
            time.sleep(0.5)
            continue
        match = _CREDENTIALS_RE.search(line)

    if serial_port is not None:
        serial_port.close()

    if match is None:
        print("[rescue-credentials] identifiants non reçus sur le port série")
        return

    ssid = match.group(1).decode("utf-8", errors="strict")
    password = match.group(2).decode("utf-8", errors="strict")
    _write_access_file(project_dir, ssid, password, "flash")


def _access_path(project_dir):
    override = os.environ.get("FLOWIO_LOCAL_DEVICE_DIR")
    return (Path(override) if override else Path(project_dir) / "local-device") / "rescue-access.txt"


def _ensure_qr_dependencies(project_dir):
    if all(importlib.util.find_spec(name) is not None for name in ("qrcode", "png")):
        return
    requirements = Path(project_dir) / "scripts" / "requirements-flash.txt"
    subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(requirements)], check=True)


def _wifi_qr_payload(ssid, password):
    # https://github.com/zxing/zxing/wiki/Barcode-Contents#wi-fi-network-config-android-ios-11
    def escape(value):
        return "".join("\\" + char if char in '\\;,":' else char for char in value)
    return f"WIFI:T:WPA;S:{escape(ssid)};P:{escape(password)};;"


def _write_wifi_qr(output_path, ssid, password):
    import qrcode
    from qrcode.image.pure import PyPNGImage

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q,
                       box_size=10, border=4)
    qr.add_data(_wifi_qr_payload(ssid, password))
    qr.make(fit=True)
    temp_path = output_path.with_suffix(".png.tmp")
    with temp_path.open("wb") as stream:
        qr.make_image(image_factory=PyPNGImage).save(stream)
    temp_path.replace(output_path)


def _write_access_file(project_dir, ssid, password, operation):
    output_path = _access_path(project_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    content = (
        "Flow.io — accès au portail Rescue\n"
        f"Généré après {operation} : {datetime.now().astimezone().isoformat(timespec='seconds')}\n\n"
        f"Réseau Wi-Fi : {ssid}\n"
        f"Mot de passe : {password}\n"
        "Connexion Wi-Fi par QR code : rescue-wifi.png\n"
        "Adresse : http://192.168.4.1/rescue\n"
        "Interface complète : http://192.168.4.1/webinterface\n\n"
        "Le point d’accès doit être ouvert pour utiliser ces adresses.\n"
        "Conserver ce fichier localement : il contient un mot de passe en clair.\n"
    )
    temp_path = output_path.with_suffix(".txt.tmp")
    temp_path.write_text(content, encoding="utf-8")
    temp_path.replace(output_path)
    _write_wifi_qr(output_path.with_name("rescue-wifi.png"), ssid, password)
    print(f"[rescue-credentials] fichier d’accès enregistré dans {output_path}")
    print(f"[rescue-credentials] QR code Wi-Fi enregistré dans {output_path.with_name('rescue-wifi.png')}")


def _prepare_capture(source, target, env):
    _ensure_qr_dependencies(env.subst("$PROJECT_DIR"))


def _capture_rescue_credentials(source, target, env):
    _capture_from_port(env.subst("$UPLOAD_PORT"), env.subst("$PROJECT_DIR"))


if env is not None:
    for upload_target in ("upload", "uploadfs"):
        env.AddPreAction(upload_target, _prepare_capture)
        env.AddPostAction(upload_target, _capture_rescue_credentials)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()
    _ensure_qr_dependencies(args.project_dir)
    _capture_from_port(args.port, args.project_dir, args.reset)
