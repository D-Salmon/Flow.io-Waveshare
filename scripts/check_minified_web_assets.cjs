const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { minify: parseJs } = require("terser");

const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "data", "webinterface");
const manifest = JSON.parse(fs.readFileSync(path.join(webRoot, ".minified-assets.json"), "utf8"));

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

(async () => {
  for (const [relativePath, metadata] of Object.entries(manifest.assets)) {
    const sourcePath = path.join(webRoot, ...relativePath.split("/"));
    const source = fs.readFileSync(sourcePath);
    const compressed = fs.readFileSync(`${sourcePath}.gz`);
    if (sha256(source) !== metadata.source_sha256) throw new Error(`Source changed without rebuilding web assets: ${relativePath}`);
    if (sha256(compressed) !== metadata.gzip_sha256) throw new Error(`Compressed asset does not match its manifest: ${relativePath}`);
    const minified = zlib.gunzipSync(compressed).toString("utf8");
    if (relativePath.endsWith(".js")) await parseJs(minified, { compress: false, mangle: false });
    else if (relativePath.endsWith(".json")) JSON.parse(minified);
  }
  process.stdout.write(`Validated ${Object.keys(manifest.assets).length} minified web assets.\n`);
})().catch((error) => { console.error(error); process.exit(1); });
