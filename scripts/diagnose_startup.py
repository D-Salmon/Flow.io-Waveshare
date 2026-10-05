"""Read USB boot diagnostics after a flash; keep AP credentials out of output."""
import argparse
import time
import serial
from capture_rescue_credentials import _CREDENTIALS_RE, _write_access_file

parser = argparse.ArgumentParser()
parser.add_argument('--port', required=True)
parser.add_argument('--project-dir', required=True)
parser.add_argument('--after-flash', action='store_true')
args = parser.parse_args()
deadline = time.monotonic() + 40
connection = None
reset = True
while time.monotonic() < deadline:
    if connection is None:
        try:
            connection = serial.Serial(args.port, 115200, timeout=.5)
            if reset:
                connection.dtr = False
                connection.rts = True
                time.sleep(.1)
                connection.dtr = True
                connection.rts = False
                time.sleep(.1)
                connection.dtr = False
                reset = False
        except (OSError, serial.SerialException):
            time.sleep(.5)
            continue
    try:
        raw = connection.readline()
    except (OSError, serial.SerialException):
        connection.close()
        connection = None
        time.sleep(.5)
        continue
    credentials = _CREDENTIALS_RE.search(raw)
    if credentials:
        if args.after_flash:
            _write_access_file(args.project_dir, credentials.group(1).decode(), credentials.group(2).decode(), 'flash')
        continue
    line = raw.decode('utf-8', errors='replace').strip()
    if line and not any(word in line.lower() for word in ('password', 'passphrase', 'secret', 'credentials', 'ssid=')):
        print(line, flush=True)
if connection:
    connection.close()
