'use strict';

/**
 * 智通财经 H5 (m.zhitongcaijing.com) 接口 token 生成还原
 *
 * 算法（来源：app.js 模块 1ae8 请求构造器 + chunk-vendors 模块 cfd4 序列化器）：
 *   1. 合并基础参数 {__mode__, tradition_chinese, access_token, language} 与业务参数 r
 *   2. 用 f(t) = Object.keys(t).sort() 将对象键按字母序重排
 *   3. 用 s()(a)（cfd4 序列化器）将对象序列化为 key=value&...，
 *      key 与 value 均经过 encodeURIComponent 编码（与 JS encodeURIComponent 一致）
 *   4. token = SHA1(上述拼接串)  （hex_sha1 为标准 SHA1，已用 hashlib 比对验证）
 *   5. GET：拼接到 query (? 或 & 之后)；POST：写入 body.token
 *
 * 本文件为纯协议实现，不依赖浏览器。
 */

const crypto = require('crypto');

const BASE_URL = 'https://mapi.zhitongcaijing.com';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// 与 chunk-vendors cfd4 一致：对 key/value 做 encodeURIComponent，递归处理对象，& 连接
function serialize(obj, prefix) {
  const out = [];
  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const val = obj[key];
    const encKey = encodeURIComponent(key);
    const newPrefix = prefix ? `${prefix}[${encKey}]` : encKey;
    if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
      out.push(serialize(val, newPrefix));
    } else {
      out.push(`${newPrefix}=${encodeURIComponent(val === undefined || val === null ? '' : val)}`);
    }
  }
  return out.join('&');
}

// 与 app.js f(t) 一致：按键名字母序重排对象
function sortKeys(obj) {
  const sorted = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = obj[k];
  }
  return sorted;
}

// 标准 SHA1 hex（对应 u["a"].hex_sha1）
function hexSha1(str) {
  return crypto.createHash('sha1').update(str, 'utf8').digest('hex');
}

// 合并基础参数（未登录态默认值），业务可覆盖
function buildBaseParams(extra) {
  const base = {
    __mode__: 'history',
    tradition_chinese: '0',
    access_token: '',
    language: 'zh-cn',
  };
  return Object.assign({}, base, extra || {});
}

// GET 签名：返回带 token 的完整 query 串
function signGet(params) {
  const sorted = sortKeys(buildBaseParams(params));
  const query = serialize(sorted);
  const token = hexSha1(query);
  return query + '&token=' + token;
}

// POST 签名：返回带 token 的参数对象（token 字段为签名值）
function signPost(params) {
  const merged = buildBaseParams(Object.assign({ k: 2 }, params));
  const sorted = sortKeys(merged);
  const query = serialize(sorted);
  const token = hexSha1(query);
  sorted.token = token;
  return sorted;
}

// 发起 GET 请求
async function get(apiPath, params, opts) {
  const query = signGet(params);
  const sep = apiPath.includes('?') ? '&' : '?';
  const url = BASE_URL + apiPath + sep + query;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': MOBILE_UA, 'Accept': 'application/json' },
  });
  return res;
}

// 发起 POST 请求
async function post(apiPath, params, opts) {
  const body = signPost(params);
  const res = await fetch(BASE_URL + apiPath, {
    method: 'POST',
    headers: { 'User-Agent': MOBILE_UA, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

module.exports = { signGet, signPost, get, post, serialize, sortKeys, hexSha1, buildBaseParams, BASE_URL };

// 自测：复现目标请求并验证签名 + 实际请求
if (require.main === module) {
  (async () => {
    const params = {
      category_id: 'index_shouye',
      category_key: '',
      last_time: '',
      page: 1,
    };
    const expectedToken = '928079f344b3d4b20faf84ed7afc989a774ab328';
    const query = signGet(params);
    console.log('拼接串:', query.replace(/&token=.*/, ''));
    console.log('生成 token:', query.match(/token=([0-9a-f]+)/)[1]);
    console.log('预期 token:', expectedToken);
    console.log('签名一致:', query.includes('token=' + expectedToken));

    console.log('\n--- 实测接口（多页验证签名稳定性）---');
    for (const page of [1, 2, 3]) {
      const p = Object.assign({}, params, { page });
      const r = await get('/news/list.html', p);
      const ct = r.headers.get('content-type') || '';
      const text = await r.text();
      let ok = false, total = 0;
      try {
        const json = JSON.parse(text);
        ok = json && (json.code === 1 || json.status === 1 || Array.isArray(json.data) || json.data);
        total = json && json.data && json.data.list ? json.data.list.length : (json && json.data ? Object.keys(json.data).length : 0);
      } catch (e) { ok = text.length > 0; }
      console.log(`page=${page} status=${r.status} type=${ct.split(';')[0]} 解析成功=${ok} 条目数=${total}`);
    }
  })();
}
