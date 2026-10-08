"""Read-only on-device contract checks and dashboard config HTTP benchmarks.

Usage: python scripts/tests/check_device_config_batch.py http://192.168.31.6
Only timings and counts are printed; configuration values and secrets stay local.
"""
import concurrent.futures
import gzip
import json
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PRIMARY = ["poollogic/" + name for name in (
    "modes", "filtration", "heater", "refill", "safety", "regulation", "robot",
    "chlorine", "swg", "o2", "sensors", "pool")]
DEFERRED = ["poollogic/devices"] + ["io/drivers/" + name for name in (
    "ds18b20", "ads1115_int", "ads1115_ext", "bme680", "bmp280")]
DEFERRED += ["io/input/i01"] + [f"io/input/a{i:02d}" for i in range(16)]
DEFERRED += [f"io/output/d{i:02d}" for i in range(8)]


def main(base):
    def get(path, expected=200):
        try:
            response = urllib.request.urlopen(base.rstrip("/") + path, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            statuses = (expected,) if isinstance(expected, int) else expected
            assert response.status in statuses, (path.split("?")[0], response.status, expected)
            body = response.read()
            wire_size = len(body)
            if response.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return json.loads(body), response.headers, wire_size

    def batch(names):
        payload, headers, size = get("/api/flowcfg/batch?" + urllib.parse.urlencode({"names": json.dumps(names)}))
        assert payload["ok"] and set(payload["modules"]) == set(names)
        assert "no-store" in headers["Cache-Control"]
        return payload["modules"], size

    def single(name):
        payload, headers, size = get("/api/flowcfg/module?" + urllib.parse.urlencode({"name": name}))
        assert payload["ok"] and not payload["truncated"]
        assert "no-store" in headers["Cache-Control"]
        return {name: payload["data"]}, size

    invalid = [None, "not-json", "{}", "[]", '[1]', '[null]', '[""]',
               json.dumps(["a" * 64]), json.dumps(["a" * 1100]),
               json.dumps(PRIMARY[:8] + ["poollogic/pool"]),
               json.dumps(["poollogic/pool", "poollogic/pool"]),
               json.dumps(["poollogic/pool\0suffix"])]
    for value in invalid:
        path = "/api/flowcfg/batch"
        if value is not None:
            path += "?" + urllib.parse.urlencode({"names": value})
        payload, _, _ = get(path, 400)
        assert not payload["ok"] and "modules" not in payload
    for names in [["a" * 63], ["poollogic/pool", "unknown/module"]]:
        payload, _, _ = get("/api/flowcfg/batch?" + urllib.parse.urlencode({"names": json.dumps(names)}), 404)
        assert not payload["ok"] and "modules" not in payload

    secrets, _ = batch(["mqtt", "wifi"])
    for name in secrets:
        assert secrets[name] == single(name)[0][name], "Batch must use the canonical masked serializer"
        assert secrets[name]["pass"] == "***", "Secrets must stay masked"

    meta, _, _ = get("/api/web/meta")
    version = meta["web_asset_version"]
    static_paths = ["/api/cfgdoc/index", "/api/cfgdoc/module?name=poollogic/pool",
                    "/api/cfgdoc/i18n?locale=fr", "/webinterface/i18n/fr.json"]
    protected_assets = 0
    for path in static_paths:
        separator = "&" if "?" in path else "?"
        payload, headers, _ = get(path + separator + urllib.parse.urlencode({"v": version}), (200, 403))
        if payload.get("err", {}).get("code") == "Forbidden":
            protected_assets += 1
            continue  # Documentation requires an administrator session; do not bypass it.
        assert "immutable" in headers["Cache-Control"]
        _, headers, _ = get(path + separator + "v=obsolete")
        assert "no-store" in headers["Cache-Control"]

    def measure(use_batch):
        data, sizes, elapsed = {}, 0, []
        start = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            for phase in (PRIMARY, DEFERRED):
                for offset in range(0, len(phase), 8 if use_batch else 3):
                    names = phase[offset:offset + (8 if use_batch else 3)]
                    responses = [batch(names)] if use_batch else list(pool.map(single, names))
                    for modules, size in responses:
                        data.update(modules)
                        sizes += size
                elapsed.append(time.perf_counter() - start)
        return {"primary_seconds": elapsed[0], "total_seconds": elapsed[1], "bytes": sizes}, data

    timings = {"individual": [], "batch": []}
    for _ in range(3):
        old, old_data = measure(False)
        new, new_data = measure(True)
        assert old_data == new_data, "All 43 module values must agree"
        timings["individual"].append(old)
        timings["batch"].append(new)
    summary = {mode: {key: round(statistics.median(sample[key] for sample in samples), 3)
                      for key in samples[0]} for mode, samples in timings.items()}
    summary.update(modules=len(PRIMARY + DEFERRED), individual_requests=43, batch_requests=6,
                   protected_assets_requiring_admin=protected_assets,
                   contract="invalid input, unknown module, secret masking, equality and accessible asset cache headers passed")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
