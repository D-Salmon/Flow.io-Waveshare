const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const CleanCSS = require("clean-css");
const { minify: minifyHtml } = require("html-minifier-terser");
const { minify: minifyJs } = require("terser");

const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "data", "webinterface");
const manifestPath = path.join(webRoot, ".minified-assets.json");
const assets = [
  "index.html", "sh.html", "app.js", "network.js", "history.js", "activity.js", "users.js",
  "io-summary.js", "calibration.js", "info.js", "logs.js", "updates.js",
  "pool.js", "config.js", "i18n/fr.json", "i18n/en.json", "app-core.css",
  "network.css", "activity.css", "io-summary.css", "calibration.css",
  "app-core.js", "light.html", "light.css", "light.js", "prov.html",
  "prov.js", "runtimeui.json"
];

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function minifyAsset(relativePath, source) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".js") {
    const result = await minifyJs(source.toString("utf8"), {
      compress: false,
      // Shorten local bindings only. Public globals, object properties, API
      // field names and strings stay unchanged across separately loaded pages.
      mangle: { toplevel: false, properties: false },
      format: { comments: false, ascii_only: false, semicolons: true }
    });
    if (typeof result.code !== "string") throw new Error(`No Terser output for ${relativePath}`);
    return Buffer.from(result.code, "utf8");
  }
  if (extension === ".css") {
    const result = new CleanCSS({
      level: { 1: { all: true }, 2: false },
      rebase: false,
      compatibility: "*"
    }).minify(source.toString("utf8"));
    if (result.errors.length) throw new Error(`CleanCSS failed for ${relativePath}: ${result.errors.join("; ")}`);
    return Buffer.from(result.styles, "utf8");
  }
  if (extension === ".html") {
    const result = await minifyHtml(source.toString("utf8"), {
      collapseWhitespace: true,
      conservativeCollapse: true,
      continueOnParseError: false,
      decodeEntities: false,
      keepClosingSlash: true,
      minifyCSS: { level: { 1: { all: true }, 2: false }, rebase: false, compatibility: "*" },
      minifyJS: { compress: false, mangle: false, format: { comments: false, ascii_only: false, semicolons: true } },
      removeComments: true,
      removeOptionalTags: false,
      removeRedundantAttributes: false,
      removeScriptTypeAttributes: false,
      removeStyleLinkTypeAttributes: false,
      sortAttributes: false,
      sortClassName: false,
      useShortDoctype: false
    });
    return Buffer.from(result, "utf8");
  }
  if (extension === ".json") return Buffer.from(JSON.stringify(JSON.parse(source.toString("utf8"))), "utf8");
  throw new Error(`Unsupported asset type: ${relativePath}`);
}

(async () => {
  const manifest = { version: 1, generator: "scripts/minify_web_assets.cjs", assets: {} };
  let totalOriginal = 0, totalMinified = 0, totalGzip = 0;
  for (const relativePath of assets.filter((asset) => fs.existsSync(path.join(webRoot, ...asset.split("/"))))) {
    const sourcePath = path.join(webRoot, ...relativePath.split("/"));
    const source = fs.readFileSync(sourcePath);
    const minified = await minifyAsset(relativePath, source);
    const compressed = zlib.gzipSync(minified, { level: 9, mtime: 0 });
    fs.writeFileSync(`${sourcePath}.gz`, compressed);
    manifest.assets[relativePath] = {
      source_sha256: sha256(source),
      gzip_sha256: sha256(compressed),
      original_bytes: source.length,
      minified_bytes: minified.length,
      gzip_bytes: compressed.length
    };
    totalOriginal += source.length; totalMinified += minified.length; totalGzip += compressed.length;
    process.stdout.write(`${relativePath}: ${source.length} -> ${minified.length} -> ${compressed.length} bytes\n`);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`TOTAL: ${totalOriginal} -> ${totalMinified} -> ${totalGzip} bytes (minified ${(100 * totalMinified / totalOriginal).toFixed(1)}%, gzip ${(100 * totalGzip / totalOriginal).toFixed(1)}%)\n`);
})().catch((error) => { console.error(error); process.exit(1); });
