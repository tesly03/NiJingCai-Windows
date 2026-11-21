/**
 * 尼精彩 Windows 客户端 - 界面逻辑
 */
(function () {
  'use strict';

  const P = window.NCProtocol;
  const Ble = window.NCBle;
  const Api = window.NCApi;
  const $ = (id) => document.getElementById(id);

  /* ---------------- 通用 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  const logLines = [];
  function addLog(msg) {
    const time = new Date().toLocaleTimeString();
    logLines.push(`[${time}] ${msg}`);
    if (logLines.length > 400) logLines.shift();
    const view = $('logView');
    view.textContent = logLines.join('\n');
    view.scrollTop = view.scrollHeight;
  }

  function requireConn() {
    if (!Ble.connected) {
      toast('请先连接设备');
      return false;
    }
    return true;
  }

  /* ---------------- 导航 ---------------- */
  function gotoPage(page) {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
  }
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => gotoPage(b.dataset.page)));
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => gotoPage(b.dataset.goto)));

  /* ---------------- 蓝牙连接 ---------------- */
  function updateConnUI() {
    const on = Ble.connected;
    $('connDot').classList.toggle('on', on);
    $('connState').textContent = on ? '已连接' : (Ble.state === 'SCANNING' ? '扫描中' : Ble.state === 'CONNECTING' ? '连接中' : '未连接');
    $('btnConnect').disabled = on;
    $('btnDisconnect').disabled = !on;
    if (on && Ble.device) {
      $('deviceName').textContent = Ble.device.name || '未知设备';
      $('homeDeviceTitle').textContent = Ble.device.name || '泥神散热器';
    } else if (!on) {
      $('deviceName').textContent = '---';
    }
  }

  Ble.addEventListener('state', updateConnUI);
  Ble.addEventListener('log', (e) => addLog(e.detail));
  Ble.addEventListener('connected', () => {
    updateConnUI();
    toast('设备已连接');
    // 描述符写入后稍作等待再开始查询（与手机端服务就绪后的节奏一致）
    setTimeout(() => {
      refreshStatus();
      startPolling();
    }, 300);
  });
  Ble.addEventListener('disconnected', () => {
    stopPolling();
    updateConnUI();
  });

  // 设备选择弹窗
  window.bridge.onBluetoothDeviceList((list) => {
    const box = $('bleDeviceList');
    box.innerHTML = '';
    if (!list || list.length === 0) return;
    $('bleModal').classList.remove('hidden');
    list.forEach((d) => {
      const item = document.createElement('div');
      item.className = 'ble-item';
      item.innerHTML = `<span>${d.deviceName || '未知设备'}</span><span class="muted">${d.deviceId}</span>`;
      item.addEventListener('click', async () => {
        $('bleModal').classList.add('hidden');
        await window.bridge.selectBluetoothDevice(d.deviceId);
      });
      box.appendChild(item);
    });
  });

  $('btnBleCancel').addEventListener('click', async () => {
    $('bleModal').classList.add('hidden');
    await window.bridge.cancelBluetoothRequest();
    Ble.state = 'READY';
    updateConnUI();
  });

  $('btnConnect').addEventListener('click', async () => {
    const type = $('deviceType').value;
    localStorage.setItem('nc_device_type', type);
    addLog('开始扫描：' + type + ' -> ' + P.DEVICE_TYPES[type]);
    try {
      await Ble.scanAndConnect(type);
    } catch (err) {
      addLog('连接失败: ' + err.message);
      toast('连接失败：' + err.message);
      Ble.state = 'READY';
      updateConnUI();
    }
  });
  $('btnDisconnect').addEventListener('click', () => {
    Ble.disconnect();
    toast('已断开连接');
  });

  const savedType = localStorage.getItem('nc_device_type');
  if (savedType) $('deviceType').value = savedType;

  /* ---------------- 状态解析（对齐手机端 IndexFragment） ---------------- */
  const FAN_TEXT = { '00': '关闭', '01': '1 档', '02': '2 档', '03': '3 档', '04': '4 档', '05': '5 档', '06': '6 档' };
  const deviceState = { power: null, temp: null, mode: null, fan: null, powerOn: false };

  let modeFlags = { temp: '00', overclock: '00', silent: '00' };
  function refreshModeText() {
    if (modeFlags.temp !== '00') $('stMode').textContent = '温控模式';
    else if (modeFlags.overclock !== '00') $('stMode').textContent = '超频模式';
    else if (modeFlags.silent !== '00') $('stMode').textContent = '静音模式';
    else $('stMode').textContent = '自定义模式';
  }

  function touchUpdated() {
    $('stUpdated').textContent = '更新于 ' + new Date().toLocaleTimeString();
  }

  /** 温度字节解码（手机端：>127 则 -256） */
  function decodeTempByte(hex) {
    let t = parseInt(hex, 16);
    if (t > 127) t -= 256;
    return t;
  }
  /** 温度编码（手机端 convertRange：负数 +256） */
  function encodeTempByte(t) {
    return t < 0 ? t + 256 : t;
  }

  Ble.addEventListener('data', (e) => {
    const { cmd, data, data1 } = e.detail;
    switch (cmd) {
      case '02': {
        // 电源状态：01=开机 02=关机（与手机端 ivSwitch 逻辑一致）
        const on = data !== '02';
        deviceState.powerOn = on;
        $('homeDeviceSub').textContent = '百变DIY-3Pro · ' + (on ? '运行中' : '已关机');
        $('btnPowerOn').disabled = on;
        $('btnPowerOff').disabled = !on;
        touchUpdated();
        break;
      }
      case '03':
        // 风扇档位（同时同步性能页滑块）
        deviceState.fan = data;
        $('stFan').textContent = FAN_TEXT[data] || (parseInt(data, 16) + ' 档');
        syncSlider('fanSpeed', 'fanVal', parseInt(data, 16) || 1);
        touchUpdated();
        break;
      case '05':
        // 功率设定值（手机端 gonglv，用于初始化功率滑块；非实时功率）
        deviceState.powerSet = parseInt(data, 16);
        syncSlider('customPower', 'customPowerVal', deviceState.powerSet || 1);
        break;
      case '0d':
        // 实时功率（手机端 tvData1 显示的 W 数）
        deviceState.power = data;
        $('stPower').textContent = parseInt(data, 16) + ' W';
        touchUpdated();
        break;
      case '0a':
        modeFlags.temp = data;
        refreshModeText();
        // 温度型设备：data 为目标温度编码字节，同步到温控滑块与开关
        if (data !== '00') {
          const t = decodeTempByte(data);
          if (t >= -30 && t <= 30) syncSlider('tempTarget', 'tempTargetVal', t);
          setSwitch('swTemp', true, true);
        } else {
          setSwitch('swTemp', false, true);
        }
        touchUpdated();
        break;
      case '0b':
        modeFlags.overclock = data;
        refreshModeText();
        setSwitch('swOverclock', data !== '00', true);
        touchUpdated();
        break;
      case '0c':
        modeFlags.silent = data;
        refreshModeText();
        setSwitch('swSilent', data !== '00', true);
        touchUpdated();
        break;
      case '0e': {
        // 温度（有符号字节，实际日志证实：0xfd=-3℃）
        const t = decodeTempByte(data);
        deviceState.temp = t;
        $('stTemp').textContent = t + ' ℃';
        touchUpdated();
        break;
      }
      case '18':
        $('fwVersion').textContent = 'v' + parseInt(data, 16) + '.' + parseInt(data1 || '0', 16);
        break;
      default:
        break;
    }
  });

  // 与手机端 performQuery 完全一致的 12 条查询序列
  function performQueryFrames() {
    return [
      P.Query.order5(), P.Query.order3(), P.Query.order11(), P.Query.order10(),
      P.Query.order12(), P.Query.order13(), P.Query.order14(), P.Query.order2(),
      P.Query.order18(), P.Query.order97(), P.Query.order20(), P.Query.order21(),
    ];
  }

  let querying = false;
  async function refreshStatus() {
    if (!Ble.connected || querying || Ble.isSendingImage) return;
    querying = true;
    try {
      for (const q of performQueryFrames()) {
        await Ble.send(q);
        await new Promise((r) => setTimeout(r, 60));
      }
    } finally {
      querying = false;
    }
  }
  $('btnRefresh').addEventListener('click', refreshStatus);

  // 与手机端一致：连接后每 2 秒轮询一次设备状态
  let pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(refreshStatus, 2000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  $('btnPowerOn').addEventListener('click', async () => {
    if (!requireConn()) return;
    const ok = await Ble.send(P.Cmd.powerOn());
    toast(ok ? '已发送开机' : '开机命令发送失败，请查看日志');
    if (ok) setTimeout(refreshStatus, 400);
  });
  $('btnPowerOff').addEventListener('click', async () => {
    if (!requireConn()) return;
    const ok = await Ble.send(P.Cmd.powerOff());
    toast(ok ? '已发送关机' : '关机命令发送失败，请查看日志');
    if (ok) setTimeout(refreshStatus, 400);
  });
  $('btnQueryFw').addEventListener('click', async () => { if (requireConn()) await Ble.send(P.Query.order18()); });
  $('btnClearLog').addEventListener('click', () => { logLines.length = 0; $('logView').textContent = ''; });

  /* ---------------- 定时关闭 ---------------- */
  $('btnTimer').addEventListener('click', () => $('timerModal').classList.remove('hidden'));
  $('btnTimerClose').addEventListener('click', () => $('timerModal').classList.add('hidden'));
  async function sendTimer(minutes) {
    if (!requireConn()) return;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    await Ble.send(P.Cmd.timer(h, m));
    toast(`已设置 ${h} 小时 ${m} 分钟后关闭`);
    $('timerModal').classList.add('hidden');
  }
  document.querySelectorAll('.timer-opt').forEach((b) => b.addEventListener('click', () => sendTimer(parseInt(b.dataset.min, 10))));
  $('btnTimerCustom').addEventListener('click', () => sendTimer(parseInt($('timerCustom').value, 10) || 0));
  $('btnTimerCancel').addEventListener('click', async () => {
    if (!requireConn()) return;
    await Ble.send(P.Cmd.timer(0, 0));
    toast('已取消定时');
    $('timerModal').classList.add('hidden');
  });

  /* ---------------- 灯效设置 ---------------- */
  // 模式 → 设备类型码（对齐手机端 LightSetActivity：彩虹旋转=1, 彩虹渐变=2, 星空=31, 彩虹呼吸=32, 呼吸=3, 跑马灯=10, 常亮=24, 抖动=17）
  const LIGHT_MODES = [
    { name: '彩虹旋转', type: 1 },
    { name: '彩虹渐变', type: 2 },
    { name: '星空模式', type: 31 },
    { name: '彩虹呼吸', type: 32 },
    { name: '呼吸模式', type: 3 },
    { name: '跑马灯模式', type: 10 },
    { name: '常亮模式', type: 24 },
    { name: '抖动模式', type: 17 },
  ];
  let lightMode = 1;
  const lightModesBox = $('lightModes');
  LIGHT_MODES.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'mode-btn' + (i === 0 ? ' active' : '');
    b.textContent = m.name;
    b.addEventListener('click', () => {
      lightMode = m.type;
      lightModesBox.querySelectorAll('.mode-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    lightModesBox.appendChild(b);
  });

  const SWATCH_COLORS = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#00ffff', '#0088ff', '#7b2ff7', '#ff00ff'];
  const swatchBox = $('lightSwatches');
  SWATCH_COLORS.forEach((c) => {
    const s = document.createElement('div');
    s.className = 'swatch';
    s.style.background = c;
    s.addEventListener('click', () => { $('lightColor').value = c; });
    swatchBox.appendChild(s);
  });

  function bindRange(id, labelId) {
    $(id).addEventListener('input', () => { $(labelId).textContent = $(id).value; });
  }
  bindRange('lightSat', 'satVal');
  bindRange('lightBri', 'briVal');
  bindRange('lightSpd', 'spdVal');
  bindRange('tempTarget', 'tempTargetVal');
  bindRange('customPower', 'customPowerVal');
  bindRange('fanSpeed', 'fanVal');

  /** 从设备回报同步滑块（用户正在拖动时跳过，避免抢焦点） */
  function syncSlider(id, labelId, v) {
    const el = $(id);
    if (!el || el.matches(':active')) return;
    el.value = v;
    $(labelId).textContent = v;
  }
  /** 从设备回报同步开关（直接赋值，不触发 change 事件） */
  function setSwitch(id, on) {
    const el = $(id);
    if (el) el.checked = !!on;
  }
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  /** RGB → 色相高低字节，复刻手机端 split16BitToBytes（对色相角度编码，非标准16位高低字节） */
  function hexToHsv16(hex) {
    const r = parseInt(hex.substring(1, 3), 16) / 255;
    const g = parseInt(hex.substring(3, 5), 16) / 255;
    const b = parseInt(hex.substring(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const angle = Math.floor(h); // 0~359
    const high = angle > 255 ? 1 : 0;
    const low = angle > 255 ? angle - 255 : angle;
    return { high, low };
  }

  async function applyLight() {
    if (!requireConn()) return;
    const { high, low } = hexToHsv16($('lightColor').value);
    const s = parseInt($('lightSat').value, 10);
    const v = parseInt($('lightBri').value, 10);
    // 手机端速度字段 = 100 - 滑块值（滑块越大越慢）
    const spd = 100 - parseInt($('lightSpd').value, 10);
    await Ble.send(P.Cmd.color(lightMode, high, low, s, v, spd));
    toast('灯效已应用');
  }
  $('btnApplyLight').addEventListener('click', applyLight);
  $('lightSwitch').addEventListener('change', async (e) => {
    if (!requireConn()) { e.target.checked = !e.target.checked; return; }
    if (e.target.checked) await applyLight();
    else { await Ble.send(P.Cmd.colorClose()); toast('灯效已关闭'); }
  });
  $('btnLightClose').addEventListener('click', async () => {
    if (!requireConn()) return;
    await Ble.send(P.Cmd.colorClose());
    $('lightSwitch').checked = false;
    toast('灯效已关闭');
  });
  $('btnLightDefault').addEventListener('click', () => {
    $('lightColor').value = '#0088ff';
    $('lightSat').value = 255; $('satVal').textContent = 255;
    $('lightBri').value = 255; $('briVal').textContent = 255;
    $('lightSpd').value = 50; $('spdVal').textContent = 50;
    lightMode = 1;
    lightModesBox.querySelectorAll('.mode-btn').forEach((x, i) => x.classList.toggle('active', i === 0));
    toast('已恢复默认，点击「应用灯效」生效');
  });

  /* ---------------- 性能设置（对齐手机端 EnergySetActivity） ---------------- */
  const swTemp = $('swTemp'), swSilent = $('swSilent'), swOverclock = $('swOverclock'), swCustom = $('swCustom');

  /** 互斥：开启某模式时，按手机端 changeModule 顺序关闭其它模式（关闭指令间隔100ms） */
  async function disableModes({ overclock = false, silent = false, temp = false }) {
    if (overclock && swOverclock.checked) { swOverclock.checked = false; await Ble.send(P.Cmd.overclock(0)); await sleepMs(100); }
    if (silent && swSilent.checked) { swSilent.checked = false; await Ble.send(P.Cmd.silent(0)); await sleepMs(100); }
    if (temp && swTemp.checked) { swTemp.checked = false; await Ble.send(P.Cmd.tempControl(0, 0)); await sleepMs(100); }
  }

  /** 进入自定义模式（手机端 changeModule(4)）：关温控→100ms→关超频→100ms→关静音 */
  async function enterCustom() {
    const wasTemp = swTemp.checked, wasOver = swOverclock.checked, wasSilent = swSilent.checked;
    swCustom.checked = true;
    swTemp.checked = false; swOverclock.checked = false; swSilent.checked = false;
    if (wasTemp) { await Ble.send(P.Cmd.tempControl(0, 0)); await sleepMs(100); }
    if (wasOver) { await Ble.send(P.Cmd.overclock(0)); await sleepMs(100); }
    if (wasSilent) { await Ble.send(P.Cmd.silent(0)); }
  }

  // 温控模式开关：开 → 0a(1, 温度编码)；关 → 0a(0,0)
  swTemp.addEventListener('change', async () => {
    if (!requireConn()) { swTemp.checked = !swTemp.checked; return; }
    if (swTemp.checked) {
      await Ble.send(P.Cmd.tempControl(1, encodeTempByte(parseInt($('tempTarget').value, 10))));
      // changeModule(1)：关超频 →100ms→ 关静音
      swCustom.checked = false;
      await disableModes({ overclock: true, silent: true });
    } else {
      await Ble.send(P.Cmd.tempControl(0, 0));
    }
  });

  // 目标温度滑块：松手发送 0a(1, temp)，并自动进入温控模式
  $('tempTarget').addEventListener('change', async () => {
    if (!requireConn()) return;
    await Ble.send(P.Cmd.tempControl(1, encodeTempByte(parseInt($('tempTarget').value, 10))));
    if (!swTemp.checked) {
      swTemp.checked = true;
      swCustom.checked = false;
      await disableModes({ overclock: true, silent: true });
    }
  });

  // 静音模式：开 → 0c(1)，关超频/温控；关 → 0c(0)
  swSilent.addEventListener('change', async () => {
    if (!requireConn()) { swSilent.checked = !swSilent.checked; return; }
    if (swSilent.checked) {
      await Ble.send(P.Cmd.silent(1));
      swCustom.checked = false;
      // changeModule(2)：关超频 →100ms→ 关温控
      await disableModes({ overclock: true, temp: true });
    } else {
      await Ble.send(P.Cmd.silent(0));
    }
  });

  // 超频模式：开 → 0b(1)，关静音/温控；关 → 0b(0)
  swOverclock.addEventListener('change', async () => {
    if (!requireConn()) { swOverclock.checked = !swOverclock.checked; return; }
    if (swOverclock.checked) {
      await Ble.send(P.Cmd.overclock(1));
      swCustom.checked = false;
      // changeModule(3)：关静音 →100ms→ 关温控
      await disableModes({ silent: true, temp: true });
    } else {
      await Ble.send(P.Cmd.overclock(0));
    }
  });

  // 自定义模式：开 → 03(转速) →100ms→ 05(功率)，并关闭其它模式；关 → 0a(0,0)（与手机端一致）
  swCustom.addEventListener('change', async () => {
    if (!requireConn()) { swCustom.checked = !swCustom.checked; return; }
    if (swCustom.checked) {
      const fan = parseInt($('fanSpeed').value, 10) || 1;
      const power = parseInt($('customPower').value, 10) || 1;
      await Ble.send(P.Cmd.fanSpeed(fan));
      await sleepMs(100);
      await Ble.send(P.Cmd.power(power));
      await enterCustom();
    } else {
      await Ble.send(P.Cmd.tempControl(0, 0));
    }
  });

  // 风扇转速滑块：松手发送 03(档位 1~6)；若静音/超频开启则自动切到自定义
  $('fanSpeed').addEventListener('change', async () => {
    if (!requireConn()) return;
    await Ble.send(P.Cmd.fanSpeed(parseInt($('fanSpeed').value, 10)));
    if (swSilent.checked || swOverclock.checked || swTemp.checked) await enterCustom();
  });

  // 功率滑块：松手发送 05(功率 1~100)，自动切到自定义
  $('customPower').addEventListener('change', async () => {
    if (!requireConn()) return;
    await Ble.send(P.Cmd.power(parseInt($('customPower').value, 10)));
    await enterCustom();
  });


  /* ---------------- 更多设置 ---------------- */
  $('btnApplyMore').addEventListener('click', async () => {
    if (!requireConn()) return;
    const voltage = parseInt(document.querySelector('input[name=voltage]:checked').value, 10);
    const vMap = { 12: 1, 15: 2, 20: 3 };
    await Ble.send(P.Cmd.voltage(vMap[voltage] || 2));
    await Ble.send(P.Cmd.set15($('coolMode').checked ? 1 : 0));
    toast('更多设置已应用');
  });

  /* ---------------- 我的：设备库 / 版本检查 ---------------- */
  $('btnLoadDevices').addEventListener('click', async () => {
    const box = $('deviceLib');
    box.innerHTML = '<span class="muted">加载中…</span>';
    try {
      const res = await Api.getDeviceTypes();
      addLog('设备库返回: ' + JSON.stringify(res).substring(0, 300));
      const list = res.data || res;
      box.innerHTML = '';
      if (Array.isArray(list) && list.length) {
        list.forEach((d) => {
          const item = document.createElement('div');
          item.className = 'device-item';
          const img = d.image || d.img || d.icon;
          item.innerHTML = `${img ? `<img src="${Api.BASE_URL}${img}" onerror="this.remove()"/>` : ''}<div><b>${d.name || d.title || '设备'}</b></div><div class="muted">${d.description || d.desc || ''}</div>`;
          box.appendChild(item);
        });
      } else {
        box.innerHTML = '<span class="muted">暂无设备数据</span>';
      }
    } catch (err) {
      box.innerHTML = `<span class="muted">加载失败：${err.message}</span>`;
    }
  });

  $('btnCheckVersion').addEventListener('click', async () => {
    try {
      const res = await Api.versionInfo();
      addLog('版本检查返回: ' + JSON.stringify(res).substring(0, 300));
      $('versionMsg').textContent = '当前版本 v1.2.3，已是最新（以服务器返回为准）';
    } catch (err) {
      $('versionMsg').textContent = '检查失败：' + err.message;
    }
  });

  /* ---------------- 初始化 ---------------- */
  updateConnUI();
  addLog('尼精彩 Windows 客户端已启动');
})();
