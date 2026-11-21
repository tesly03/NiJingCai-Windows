/**
 * 尼精彩云端 API（与手机端一致）
 * baseUrl: https://www.nijingcai.com/adm/api/
 * 认证：请求头 Authorization: <accessToken>
 */
(function (global) {
  'use strict';

  const BASE_URL = 'https://www.nijingcai.com/adm/api/';
  const TOKEN_KEY = 'nc_access_token';
  const USER_KEY = 'nc_user_info';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

  async function request(path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = token;
    const resp = await fetch(BASE_URL + path, {
      method: method || 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.json();
  }

  const Api = {
    BASE_URL,
    getToken,
    setToken,
    isLoggedIn: () => !!getToken(),
    getSavedUser: () => {
      try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
    },
    saveUser: (u) => localStorage.setItem(USER_KEY, JSON.stringify(u || {})),
    logout: () => { setToken(''); localStorage.removeItem(USER_KEY); },

    /** 获取短信验证码 */
    getCode: (phone) => request('sms/code', { phone }),
    /** 手机号 + 验证码登录 */
    login: (phone, code) => request('app/phoneLogin', { phone, code }),
    /** 推荐设备 */
    getRecommendDevice: () => request('app/device/getAppRecommendDevice', null, 'GET'),
    /** 设备分类列表 */
    getDeviceTypes: () => request('app/device/getAppDeviceTypeData', null, 'GET'),
    /** 设备详情 */
    getDeviceDetail: (id) => request('app/device/getAppDeviceById', { id }),
    /** 版本检查（配置 ID 与手机端一致） */
    versionInfo: () => request('app/sysConfig/getSysConfig/802811894587397'),
    /** 当前登录用户信息 */
    getUserInfo: () => request('app/getLoginUserInfo'),
  };

  global.NCApi = Api;
})(typeof window !== 'undefined' ? window : globalThis);
