/**
 * 采集插件安装包构建脚本
 *
 * 背景：此前 ZIP 是手工打包的，项目里没有任何脚本，改了 extension/ 源码后
 * 若忘记重新打包，扩展坞下载到的就是旧包 —— 属于典型的"线上与源码不同步"隐患。
 * 现在把打包固化进构建流程：npm run build 会先执行本脚本，永远用最新源码出包。
 *
 * 产物：public/downloads/thalvior-collect-extension.zip
 * 结构要求：manifest.json 必须在压缩包根目录（Chrome「加载已解压的扩展程序」的硬性要求）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "extension");
const outDir = join(root, "public", "downloads");
const outZip = join(outDir, "thalvior-collect-extension.zip");

// 必须进包的文件（缺一不可，缺了插件在浏览器里就是废包）
const REQUIRED = [
  "manifest.json",
  "content.js",
  "background.js",
  "popup.js",
  "popup.html",
  "install-marker.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

function fail(msg) {
  console.error(`\n❌ 采集插件打包失败：${msg}`);
  process.exit(1);
}

// 1) 校验源码完整
for (const f of REQUIRED) {
  if (!existsSync(join(srcDir, f))) fail(`缺少源文件 extension/${f}`);
}

// 2) 校验版本号：manifest 版本必须与包内一致，避免"面板显示 v1.2.0 但包是旧的"
const manifest = JSON.parse(readFileSync(join(srcDir, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) fail("manifest_version 必须为 3");
if (!manifest.version) fail("manifest.json 缺少 version");

// 3) 出包（zip 内不带顶层目录）
mkdirSync(outDir, { recursive: true });
rmSync(outZip, { force: true });
try {
  execFileSync(
    "zip",
    ["-r", "-q", "-X", outZip, ...REQUIRED],
    { cwd: srcDir, stdio: "pipe" },
  );
} catch (e) {
  fail(`zip 执行失败（${e.message}）`);
}

// 4) 回读校验：解压后逐文件比对 sha256，确保包内容与源码一致
const tmp = join(root, ".ext-verify");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
execFileSync("unzip", ["-q", "-o", outZip, "-d", tmp], { stdio: "pipe" });

let mismatch = [];
for (const f of REQUIRED) {
  const a = sha256(readFileSync(join(srcDir, f)));
  const b = sha256(readFileSync(join(tmp, f)));
  if (a !== b) mismatch.push(f);
}
rmSync(tmp, { recursive: true, force: true });

if (mismatch.length) fail(`包内容与源码不一致：${mismatch.join(", ")}`);

const size = statSync(outZip).size;
console.log(
  `✅ 采集插件安装包已生成：v${manifest.version} · ${REQUIRED.length} 个文件 · ${size} 字节 · sha256 ${sha256(readFileSync(outZip))}`,
);
console.log(`   ${join("public", "downloads", "thalvior-collect-extension.zip")}`);
