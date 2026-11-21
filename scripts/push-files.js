// 通过 GitHub Contents API 推送源码文件（走 api.github.com，绕过被墙的 github.com）
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'tesly03';
const REPO = 'NiJingCai-Windows';
const BRANCH = 'main';
const ROOT = path.join(__dirname, '..');

const FILES = [
  '.gitignore',
  'README.md',
  'package.json',
  'start.bat',
  'src/main.js',
  'src/preload.js',
  'src/protocol.js',
  'src/ble.js',
  'src/api.js',
  'src/app.js',
  'src/index.html',
  'src/styles.css',
  'scripts/push-files.js',
  'scripts/publish-release.js',
];

const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `token ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'nijingcai-publisher',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  return { status: res.status, json, text };
};

(async () => {
  for (const rel of FILES) {
    const abs = path.join(ROOT, rel);
    const content = fs.readFileSync(abs);
    const b64 = content.toString('base64');
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${rel.split('/').map(encodeURIComponent).join('/')}`;

    // 已存在则取 sha 以便更新
    const existing = await api(`${url}?ref=${BRANCH}`);
    const body = { message: `add ${rel}`, content: b64, branch: BRANCH };
    if (existing.status === 200 && existing.json && existing.json.sha) body.sha = existing.json.sha;

    const put = await api(url, { method: 'PUT', body: JSON.stringify(body) });
    if (put.status === 200 || put.status === 201) {
      console.log(`OK  ${rel}`);
    } else {
      console.log(`FAIL ${rel} -> ${put.status}: ${put.text.slice(0, 200)}`);
      process.exitCode = 1;
    }
    // 避免并发冲突，串行即可
  }
})();
