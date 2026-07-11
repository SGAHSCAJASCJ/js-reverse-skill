// iwencai hexin-v 生成器：vm 沙箱执行 chameleon.js
// chameleon.js 生成 cookie "v"，即为 hexin-v header 值
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHAMELEON_PATH = path.join(__dirname, '..', 'workspace', 'js', 'chameleon.1.9.min.1783727.js');
const chameleonCode = fs.readFileSync(CHAMELEON_PATH, 'utf8');

// 固定 UA（与请求 UA 一致）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

/**
 * 创建最小浏览器环境
 * chameleon.js 需要：document/navigator/window/location 等
 */
function createBrowserEnv() {
  const cookies = {};

  const document = {
    cookie: '',
    readyState: 'complete',
    documentElement: { style: {} },
    body: { appendChild() {}, removeChild() {} },
    head: { appendChild() {}, removeChild() {}, getElementsByTagName() { return []; } },
    getElementsByTagName(tag) {
      if (tag === 'head' || tag === 'script') return [this.head];
      return [];
    },
    getElementById() { return null; },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        src: '',
        href: '',
        rel: '',
        type: '',
        async: false,
        crossOrigin: '',
        onload: null,
        onerror: null,
        onreadystatechange: null,
        readyState: '',
        getContext() { return null; },
        appendChild() {},
        removeChild() {},
        setAttribute() {},
        getAttribute() { return null; },
        addEventListener() {},
        removeEventListener() {},
        attachEvent() {},
        text: '',
        innerHTML: '',
      };
      return el;
    },
    addEventListener() {},
    removeEventListener() {},
    attachEvent() {},
    detachEvent() {},
    location: null, // 后面赋值
  };

  // cookie 实现
  Object.defineProperty(document, 'cookie', {
    get() {
      return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    },
    set(str) {
      // 解析 "name=value;expires=...;path=/;domain=..."
      const parts = str.split(';');
      const pair = parts[0].trim();
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const name = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        cookies[name] = value;
      }
    },
  });

  const navigator = {
    userAgent: UA,
    platform: 'Win32',
    plugins: { length: 3, 0: { name: 'PDF Viewer' }, 1: { name: 'Chrome PDF Viewer' }, 2: { name: 'Chromium PDF Viewer' } },
    mimeTypes: { length: 2, 0: { type: 'application/pdf' }, 1: { type: 'text/pdf' } },
    language: 'zh-CN',
    languages: ['zh-CN', 'zh', 'en'],
    maxTouchPoints: 0,
    hardwareConcurrency: 8,
    appVersion: UA.replace('Mozilla/', ''),
    vendor: 'Google Inc.',
    vendorSub: '',
    product: 'Gecko',
    productSub: '20030107',
    appName: 'Netscape',
    appCodeName: 'Mozilla',
    cookieEnabled: true,
    doNotTrack: null,
    onLine: true,
    oscpu: undefined,
    buildID: undefined,
    javaEnabled: () => false,
    taintEnabled: () => false,
    geolocation: undefined,
    mediaDevices: undefined,
    permissions: undefined,
    serviceWorker: undefined,
    webdriver: false,
  };

  const location = {
    href: 'https://www.iwencai.com/strategy',
    protocol: 'https:',
    host: 'www.iwencai.com',
    hostname: 'www.iwencai.com',
    port: '',
    pathname: '/strategy',
    search: '',
    hash: '',
    origin: 'https://www.iwencai.com',
  };
  document.location = location;

  const screen = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
  };

  // localStorage stub
  const localStorageData = {};
  const localStorage = {
    getItem(k) { return localStorageData[k] ?? null; },
    setItem(k, v) { localStorageData[k] = String(v); },
    removeItem(k) { delete localStorageData[k]; },
    clear() { Object.keys(localStorageData).forEach((k) => delete localStorageData[k]); },
    get length() { return Object.keys(localStorageData).length; },
    key(i) { return Object.keys(localStorageData)[i] ?? null; },
  };

  // XMLHttpRequest stub（chameleon.js 会 patch 它）
  function XMLHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.response = '';
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
  }
  XMLHttpRequest.prototype = {
    open() {},
    send() {},
    setRequestHeader() {},
    getResponseHeader() { return null; },
    getAllResponseHeaders() { return ''; },
    abort() {},
    addEventListener() {},
    removeEventListener() {},
  };

  // Element stub（chameleon.js 会 patch Element.prototype 上的事件方法）
  function Element() {}
  Element.prototype = {
    addEventListener() {},
    removeEventListener() {},
    attachEvent() {},
    detachEvent() {},
    getElementsByTagName() { return []; },
    getElementsByClassName() { return []; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getAttribute() { return null; },
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    removeChild() {},
    insertBefore() {},
    cloneNode() { return {}; },
    contains() { return false; },
  };

  // Document stub
  function Document() {}
  Document.prototype = Element.prototype;

  // fetch stub
  function fetch() { return Promise.resolve({ ok: true, status: 200, headers: { get() { return null; } }, json() { return Promise.resolve({}); }, text() { return Promise.resolve(''); } }); }
  fetch.toString = () => 'function fetch() { [native code] }';

  // Headers stub
  class Headers {
    constructor() { this._h = {}; }
    set(k, v) { this._h[k] = v; }
    get(k) { return this._h[k] || null; }
    has(k) { return k in this._h; }
    append(k, v) { this._h[k] = v; }
    delete(k) { delete this._h[k]; }
  }

  // window 对象
  const window = {
    document,
    navigator,
    location,
    screen,
    localStorage,
    XMLHttpRequest,
    fetch,
    Headers,
    Element,
    Document,
    addEventListener() {},
    removeEventListener() {},
    attachEvent() {},
    detachEvent() {},
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    Date,
    Math,
    RegExp,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    Error,
    TypeError,
    Promise,
    Map,
    Set,
    Symbol,
    Reflect,
    Proxy,
    console,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
    getComputedStyle() { return {}; },
    matchMedia() { return { matches: false, addListener() {}, removeListener() {} }; },
    ActiveXObject: undefined,
    WebSocket: undefined,
    globalStorage: undefined,
    innerWidth: 1920,
    innerHeight: 1080,
    outerWidth: 1920,
    outerHeight: 1080,
    devicePixelRatio: 1,
    pageXOffset: 0,
    pageYOffset: 0,
    scrollTo() {},
    alert() {},
    confirm() { return false; },
    prompt() { return null; },
    callNativeHandler: undefined,
    registerWebHandler: undefined,
    ClientMonitor: undefined,
  };
  window.window = window;
  window.self = window;
  window.top = window;
  window.parent = window;
  window.frames = window;
  window.global = window;

  return { window, document, navigator, location, screen, cookies, localStorageData };
}

/**
 * 在 vm 沙箱中运行 chameleon.js，生成 hexin-v
 */
function generateHexinV() {
  const env = createBrowserEnv();
  const { window } = env;

  // 创建沙箱上下文
  const sandbox = { ...window, window, document: window.document, navigator: window.navigator, location: window.location, screen: window.screen, localStorage: window.localStorage };
  vm.createContext(sandbox);

  // 运行 chameleon.js（捕获错误用于调试）
  try {
    vm.runInContext(chameleonCode, sandbox, { filename: 'chameleon.js', timeout: 5000 });
  } catch (e) {
    // chameleon.js 可能在某些环境检测处抛错，但 cookie "v" 可能已设置
    // 忽略非关键错误
  }

  // 读取 cookie "v"
  const cookieV = env.cookies.v;
  if (!cookieV) {
    throw new Error('chameleon.js 运行后未生成 cookie "v"（hexin-v）');
  }
  return cookieV;
}

module.exports = { generateHexinV, UA };

// 直接运行测试
if (require.main === module) {
  console.log('=== 生成 hexin-v ===');
  const hexinV = generateHexinV();
  console.log('hexin-v:', hexinV);
  console.log('长度:', hexinV.length);
  // chameleon.js 会设置 setInterval，需强制退出
  process.exit(0);
}
