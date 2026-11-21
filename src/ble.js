/**
 * 尼精彩 Windows - BLE 连接管理（基于 Web Bluetooth / Chromium GATT）
 * 复刻 Android BleHelper：扫描→连接→发现服务→开启通知→命令收发→图片分包
 */
(function (global) {
  'use strict';

  const P = global.NCProtocol;
  const PACKET_BYTES = 490;
  const MAX_RETRY = 10;
  const TIMEOUT_MS = 1000;

  class BleManager extends EventTarget {
    constructor() {
      super();
      this.device = null;
      this.server = null;
      this.writeChar = null;
      this.notifyChar = null;
      this.state = 'READY'; // READY / SCANNING / CONNECTING / CONNECTED
      this.lastSendTime = 0;
      this.isSendingImage = false;
      this._imageSession = null;
      this._pendingScan = null;
      this._writeQueue = Promise.resolve();
    }

    get connected() {
      return this.state === 'CONNECTED' && !!(this.device && this.device.gatt.connected);
    }

    _emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail }));
    }

    log(msg) {
      this._emit('log', msg);
    }

    /** 扫描并请求设备（弹出应用内设备列表，由用户选择） */
    async scanAndConnect(deviceTypeName) {
      if (!navigator.bluetooth) {
        throw new Error('当前环境不支持 Web Bluetooth，请使用打包后的桌面客户端');
      }
      this.state = 'SCANNING';
      this._emit('state', this.state);
      // 诊断模式：不过滤名称，显示周围全部 BLE 设备，
      // 用于确认设备是否在广播、以及它的真实广播名
      const options = { acceptAllDevices: true, optionalServices: [P.BLE_SERVICE_UUID] };
      this.device = await navigator.bluetooth.requestDevice(options);
      this.device.addEventListener('gattserverdisconnected', () => {
        this.state = 'READY';
        this._emit('state', this.state);
        this._emit('disconnected');
        this.log('设备已断开');
      });
      await this._connectGatt();
      return this.device;
    }

    /** 直接连接已知 device（用于重连） */
    async reconnect() {
      if (!this.device) throw new Error('无可重连设备');
      await this._connectGatt();
    }

    async _connectGatt() {
      this.state = 'CONNECTING';
      this._emit('state', this.state);
      this.log('正在连接 ' + (this.device.name || this.device.id));
      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService(P.BLE_SERVICE_UUID);
      this.writeChar = await service.getCharacteristic(P.BLE_WRITE_UUID);
      this.notifyChar = await service.getCharacteristic(P.BLE_NOTIFY_UUID);
      this.log('写特征属性: write=' + this.writeChar.properties.write +
        ' writeNoResp=' + this.writeChar.properties.writeWithoutResponse);
      await this.notifyChar.startNotifications();
      this.notifyChar.addEventListener('characteristicvaluechanged', (e) => {
        const bytes = new Uint8Array(e.target.value.buffer);
        this._onNotify(bytes);
      });
      this.state = 'CONNECTED';
      this._emit('state', this.state);
      this._emit('connected', { name: this.device.name, id: this.device.id });
      this.log('已连接，通知已开启');
    }

    disconnect() {
      if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
      this.state = 'READY';
      this._emit('state', this.state);
    }

    /** 发送命令帧（写入队列串行化，避免 GATT operation already in progress） */
    async send(bytes) {
      if (!this.connected || !this.writeChar) {
        this.log('未连接，数据被丢弃');
        return false;
      }
      // 正在发送图片时，丢弃非图片帧（与手机端 realSendData 一致）
      if (this.isSendingImage) {
        const hex = P.bytesToHex(bytes);
        if (!hex.startsWith('f55516')) {
          this.log('图片发送中，普通帧被丢弃: ' + hex);
          return false;
        }
      }
      return this._enqueue(bytes);
    }

  _enqueue(bytes) {
    // 串行队列：上一个 GATT 写完成后才发下一个；单次写入带 3 秒超时，
    // 防止 Windows 蓝牙栈偶发挂起导致整个队列卡死、状态轮询停摆。
    const task = this._writeQueue.then(async () => {
      const now = Date.now();
      const wait = 10 - (now - this.lastSendTime);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      // 与 Android writeCharacteristic 默认写类型一致：优先带响应写入
      const doWrite = async () => {
        try {
          await this.writeChar.writeValueWithResponse(bytes);
        } catch (e1) {
          await this.writeChar.writeValueWithoutResponse(bytes);
        }
      };
      await Promise.race([
        doWrite(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('写入超时(3s)')), 3000)),
      ]);
      this.lastSendTime = Date.now();
      this.log('发送: ' + P.bytesToHex(bytes));
      return true;
    }).catch((err) => {
      this.log('发送失败: ' + err.message);
      return false;
    });
    // 队列尾指针永不 reject
    this._writeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

    _onNotify(bytes) {
      const parsed = P.parseNotification(bytes);
      if (!parsed) return;
      this.log('收到: ' + parsed.hex);
      if (parsed.isImageAck) {
        this._onImageAck(bytes);
        return;
      }
      this._emit('data', parsed);
    }

    /* ---------------- 图片分包发送（复刻 ImagePacketSender） ---------------- */

    /**
     * 发送图片：imgData 为 RGB24 字节（296x240x3），imageIndex 0~5
     * onProgress(current,total)，返回 Promise<{success,message}>
     */
    sendImageRGB24(rgbData, imageIndex, onProgress) {
      if (imageIndex < 0 || imageIndex > 5) {
        return Promise.resolve({ success: false, message: '图片位置必须在 0~5 之间' });
      }
      if (this._imageSession) {
        return Promise.resolve({ success: false, message: '正在发送中，请稍后' });
      }
      const total = Math.ceil(rgbData.length / PACKET_BYTES);
      if (total > 65535) {
        return Promise.resolve({ success: false, message: '图片太大，分包数超过 65535' });
      }
      this.isSendingImage = true;
      return new Promise((resolve) => {
        this._imageSession = {
          rgbData, imageIndex, total, seq: 0, retry: 0, onProgress, resolve,
          timer: null,
        };
        this._sendPacket(0);
      });
    }

    cancelImage() {
      const s = this._imageSession;
      if (!s) return;
      clearTimeout(s.timer);
      this._imageSession = null;
      this.isSendingImage = false;
      s.resolve({ success: false, message: '发送已取消' });
    }

    _buildPacket(seq) {
      const s = this._imageSession;
      const start = seq * PACKET_BYTES;
      const chunk = s.rgbData.subarray(start, Math.min(start + PACKET_BYTES, s.rgbData.length));
      const body = new Uint8Array(PACKET_BYTES);
      body.set(chunk);
      const pkt = new Uint8Array(500);
      pkt[0] = 0xf5; pkt[1] = 0x55; pkt[2] = 0x16;
      const oneBased = seq + 1;
      pkt[3] = oneBased > 255 ? 1 : 0;
      pkt[4] = oneBased > 255 ? (seq - 255) & 0xff : oneBased & 0xff;
      pkt[5] = (s.total >> 8) & 0xff;
      pkt[6] = s.total & 0xff;
      pkt[7] = s.imageIndex;
      pkt[8] = 0;
      pkt.set(body, 9);
      pkt[499] = P.add8(body);
      return pkt;
    }

    async _sendPacket(seq) {
      const s = this._imageSession;
      if (!s) return;
      s.seq = seq;
      s.retry = 0;
      const pkt = this._buildPacket(seq);
      s.currentPacket = pkt;
      await this.send(pkt);
      if (s.onProgress) s.onProgress(seq + 1, s.total);
      this._armImageTimeout();
    }

    _armImageTimeout() {
      const s = this._imageSession;
      if (!s) return;
      clearTimeout(s.timer);
      s.timer = setTimeout(async () => {
        if (!this._imageSession) return;
        if (s.retry < MAX_RETRY) {
          s.retry++;
          await this.send(s.currentPacket);
          this._armImageTimeout();
        } else {
          this._imageSession = null;
          this.isSendingImage = false;
          s.resolve({ success: false, message: `包 ${s.seq + 1} 超过最大重发次数` });
        }
      }, TIMEOUT_MS);
    }

    _onImageAck(bytes) {
      const s = this._imageSession;
      if (!s) return;
      if (bytes.length < 6) return;
      // ACK: F5 55 16 ... 末尾三字节为 0
      if (bytes[0] === 0xf5 && bytes[1] === 0x55 && bytes[2] === 0x16 &&
          bytes[bytes.length - 1] === 0 && bytes[bytes.length - 2] === 0 && bytes[bytes.length - 3] === 0) {
        const hi = bytes[3] & 0xff;
        const lo = bytes[4] & 0xff;
        let next = hi * 255 + lo;
        if (hi > 0) next += 1;
        if (next === 0) return;
        clearTimeout(s.timer);
        if (next < s.total) {
          this._sendPacket(next - 1); // 与手机端 sendPacket(currentPacketSeq-1) 一致
        } else {
          this._imageSession = null;
          this.isSendingImage = false;
          s.resolve({ success: true, message: `所有 ${s.total} 包发送成功` });
        }
      }
    }
  }

  global.NCBle = new BleManager();
})(typeof window !== 'undefined' ? window : globalThis);
