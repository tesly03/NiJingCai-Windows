/**
 * 尼精彩 BLE 通信协议（逆向自 尼精彩_1.2.3.apk 的 DeviceOrderInfo.kt / BleHelper.kt）
 *
 * 命令帧：固定 12 字节
 *   [0]=0xF5 [1]=0x55 [2]=命令码 [3..11]=数据(补零)
 * 接收：hex 长度>=24；byte2=命令码, byte3..=数据；byte1..2=="5516" 为图片 ACK 原始通道
 * BLE：Service=0000ff20  Write=ff21  Notify=ff22  CCCD=00002902  MTU=512
 */
(function (global) {
  'use strict';

  const BLE_SERVICE_UUID = '0000ff20-0000-1000-8000-00805f9b34fb';
  const BLE_WRITE_UUID = '0000ff21-0000-1000-8000-00805f9b34fb';
  const BLE_NOTIFY_UUID = '0000ff22-0000-1000-8000-00805f9b34fb';

  // 设备型号 → 广播名（与手机端一致）
  const DEVICE_TYPES = {
    '水冷': 'NiShen-CX2-pro',
    '液冷': 'NiShen',
    '风冷': 'NiShen_FL',
    '散热器（显示屏）': 'NinShen_BH3pro',
  };

  function toHexByte(n) {
    return (n & 0xff);
  }

  /** 构造 12 字节命令帧 */
  function frame(cmd, data) {
    const f = new Uint8Array(12);
    f[0] = 0xf5;
    f[1] = 0x55;
    f[2] = toHexByte(cmd);
    if (data) {
      for (let i = 0; i < data.length && i < 9; i++) f[3 + i] = toHexByte(data[i]);
    }
    return f;
  }

  /** 查询/读取类命令（Order1~Order98） */
  const Query = {
    order1: () => frame(0x81),
    order2: () => frame(0x82),
    order3: () => frame(0x83),
    order4: () => frame(0x84),
    order5: () => frame(0x85),
    order6: () => frame(0x86),
    order7: () => frame(0x87),
    order8: () => frame(0x88),
    order9: () => frame(0x89),
    order10: () => frame(0x8a),
    order11: () => frame(0x8b),
    order12: () => frame(0x8c),
    order13: () => frame(0x8d),
    order14: () => frame(0x8e),
    order15: () => frame(0x8f),
    order16: () => frame(0x90),
    order18: () => frame(0x91),
    order20: () => frame(0x94),
    order21: () => frame(0x95),
    order97: () => frame(0x97),
    order98: () => frame(0x98),
  };

  /** 设置类命令（与手机端 DeviceOrderInfo 一一对应） */
  const Cmd = {
    // 开关：01 开 / 02 关
    powerOn: () => frame(0x02, [0x01]),
    powerOff: () => frame(0x02, [0x02]),
    // 转速 (0x03)，0=关闭
    fanSpeed: (v) => frame(0x03, [v]),
    fanSpeedReset: () => frame(0x03, [0x00]),
    // 功率 (0x05)
    power: (v) => frame(0x05, [v]),
    // 自定义功率 (0x04)
    customPower: (v) => frame(0x04, [v]),
    // 温控 (0x0a)：enable=0a[01, 档位/温度]；档位型(type1)调节=0a[档位]；关闭=0a[00,00]
    tempControl: (a, b) => frame(0x0a, b === undefined ? [a] : [a, b]),
    tempGear: (level) => frame(0x0a, [level]),
    // 超频 (0x0b)
    overclock: (v) => frame(0x0b, [v]),
    // 静音 (0x0c)
    silent: (v) => frame(0x0c, [v]),
    // 亮度 (0x11)
    brightness: (v) => frame(0x11, [v]),
    // 显示 (0x15)
    display: (v) => frame(0x15, [v]),
    // 灯效速度 (0x17)
    speed: (v) => frame(0x17, [v]),
    // 0x07 / 0x08 / 0x0f
    set07: (v) => frame(0x07, [v]),
    set08: (v) => frame(0x08, [v]),
    set0f: (v) => frame(0x0f, [v]),
    // 电压设置 (0x14)
    voltage: (v) => frame(0x14, [v]),
    // 水冷/液冷模式 (0x15 由 setOrder15 实现)
    set15: (v) => frame(0x15, [v]),
    // 固件/版本 (0x18)
    set98: (v) => frame(0x18, [v]),
    // 定时关闭 (0x10)：hour/min，byte3=1
    timer: (hour, min) => {
      const f = frame(0x10, [0x01]);
      f[9] = toHexByte(hour);
      f[10] = toHexByte(min);
      return f;
    },
    // 灯效颜色 (0x09)：模式 + HSV16(高低字节) + 饱和度 + 亮度 + 速度
    color: (type, high, low, s, v, spd) => frame(0x09, [type, high, low, s, v, spd]),
    colorClose: () => frame(0x09),
  };

  /** 字节数组 → hex 字符串 */
  function bytesToHex(bytes, upper) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += bytes[i].toString(16).padStart(2, '0');
    }
    return upper ? s.toUpperCase() : s;
  }

  /** 解析通知帧：返回 {cmd, data, data1, all, raw} */
  function parseNotification(bytes) {
    const hex = bytesToHex(bytes);
    if (hex.length < 24) return null;
    return {
      hex,
      cmd: hex.substring(4, 6),     // byte2 命令码
      data: hex.substring(6, 8),    // byte3
      data1: hex.substring(8, 10),  // byte4
      all: hex.substring(6, 18),    // byte3..8
      raw: bytes,
      isImageAck: hex.substring(2, 6) === '5516',
    };
  }

  /** 8bit 累加和校验（用于图片分包） */
  function add8(bytes) {
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) sum += bytes[i] & 0xff;
    return sum & 0xff;
  }

  global.NCProtocol = {
    BLE_SERVICE_UUID,
    BLE_WRITE_UUID,
    BLE_NOTIFY_UUID,
    DEVICE_TYPES,
    Query,
    Cmd,
    frame,
    bytesToHex,
    parseNotification,
    add8,
  };
})(typeof window !== 'undefined' ? window : globalThis);
