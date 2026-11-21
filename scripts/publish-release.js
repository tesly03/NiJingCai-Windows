// 创建 Release 并上传安装包（走 api.github.com / uploads.github.com）
const fs = require('fs');

const TOKEN = process.env.GH_TOKEN;
const OWNER = 'tesly03';
const REPO = 'NiJingCai-Windows';
const TAG = 'v1.2.3';
const EXE = 'C:/Users/Administrator/Downloads/Programs/NIJINCAI/NiJingCai-Windows/dist/尼精彩 Setup 1.2.3.exe';

const BODY = `## 尼精彩 Windows 客户端 v1.2.3

基于安卓 APK（尼精彩 1.2.3）逆向蓝牙协议重新开发的 Windows 桌面客户端，控制「泥神 / NiShen」系列散热设备。

### 功能
- 设备扫描与 BLE 连接（全量设备列表自选）
- 开机 / 关机
- 灯效设置：8 种模式（彩虹旋转/彩虹渐变/星空/彩虹呼吸/呼吸/跑马灯/常亮/抖动）+ 颜色/饱和度/亮度/速度
- 性能设置：温控/静音/超频/自定义互斥切换，转速（1~6 档）与功率（1~100W）
- 实时状态：功率 / 温度 / 模式 / 风扇档位（2 秒轮询）
- 定时开关机、电压档位等更多设置

### 安装
下载 \`尼精彩 Setup 1.2.3.exe\`，双击安装（Windows 10/11 64 位，需蓝牙 4.0+）。

### 技术栈
Electron 33 + Web Bluetooth（Chromium 原生 BLE GATT），纯前端实现无运行时依赖。

> 仅供个人学习与逆向研究，与「尼精彩」官方无关联。`;

async function main() {
  // 1. 创建（或获取）Release
  let releaseId = null;
  const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'nijingcai-publisher',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tag_name: TAG,
      target_commitish: 'main',
      name: 'v1.2.3 尼精彩 Windows 客户端',
      body: BODY,
      draft: false,
      prerelease: false,
    }),
  });
  const created = await createRes.json();
  if (createRes.status === 201) {
    releaseId = created.id;
    console.log('Release 已创建: ' + (created.html_url || releaseId));
  } else {
    // 可能已存在，按 tag 查询
    const getRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, {
      headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'nijingcai-publisher' },
    });
    const got = await getRes.json();
    if (getRes.status === 200) {
      releaseId = got.id;
      console.log('Release 已存在，复用: ' + got.html_url);
    } else {
      console.log('创建 Release 失败: ' + createRes.status + ' ' + JSON.stringify(created).slice(0, 300));
      process.exit(1);
    }
  }

  // 2. 上传安装包附件
  const buf = fs.readFileSync(EXE);
  const name = encodeURIComponent('尼精彩 Setup 1.2.3.exe');
  const upUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${name}`;
  const upRes = await fetch(upUrl, {
    method: 'POST',
    headers: {
      'Authorization': `token ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'User-Agent': 'nijingcai-publisher',
    },
    body: buf,
  });
  const upJson = await upRes.json().catch(() => ({}));
  if (upRes.status === 201) {
    console.log('附件上传成功: ' + (upJson.browser_download_url || ''));
  } else {
    console.log('附件上传失败: ' + upRes.status + ' ' + JSON.stringify(upJson).slice(0, 300));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
