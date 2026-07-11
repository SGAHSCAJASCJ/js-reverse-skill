// iwencai hexin-v 逆向交付入口
// 目标接口: https://www.iwencai.com/gateway/iwc-web-business-center/strategy_unify/strategies_page
// 目标参数: header 的 hexin-v（由 chameleon.js 生成 cookie "v"）
// 方案: L2 vm 沙箱执行 chameleon.js 生成 hexin-v，纯协议请求
const https = require('https');
const { generateHexinV, UA } = require('./hexin-v-generator');

const API_URL = 'https://www.iwencai.com/gateway/iwc-web-business-center/strategy_unify/strategies_page?type=classic&page=0&pageSize=5&annualYieldOrder=desc';

/**
 * 发起 HTTPS GET 请求
 */
function request(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: { 'User-Agent': UA, ...headers },
      timeout: 30000,
    };
    https.get(url, opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

/**
 * 使用生成的 hexin-v 请求目标接口
 */
async function fetchWithHexinV() {
  // 1. 生成 hexin-v
  const hexinV = generateHexinV();

  // 2. 发起请求
  const res = await request(API_URL, {
    Accept: 'application/json',
    'hexin-v': hexinV,
    Referer: 'https://www.iwencai.com/strategy',
  });

  return { hexinV, res };
}

// === 主流程：5 次稳定性验证 ===
(async () => {
  console.log('=== iwencai hexin-v 逆向验证 ===');
  console.log('目标接口:', API_URL);
  console.log();

  const results = [];
  for (let i = 0; i < 5; i++) {
    try {
      const { hexinV, res } = await fetchWithHexinV();
      const bodyPreview = res.body.slice(0, 200);
      let parsed = null;
      try { parsed = JSON.parse(res.body); } catch (_) {}
      const ok = parsed && (parsed.status_code === 0 || parsed.status === 0);
      results.push({ round: i + 1, hexinV, status: res.status, ok, bodyPreview });
      console.log(`[第${i + 1}次] hexin-v=${hexinV}`);
      console.log(`         HTTP ${res.status} | 业务${ok ? '成功' : '失败'} | body前200: ${bodyPreview}`);
    } catch (e) {
      results.push({ round: i + 1, error: e.message });
      console.log(`[第${i + 1}次] 错误: ${e.message}`);
    }
    // 间隔 500ms
    if (i < 4) await new Promise((r) => setTimeout(r, 500));
  }

  // 汇总
  console.log('\n=== 验证汇总 ===');
  const successCount = results.filter((r) => r.ok).length;
  console.log(`成功: ${successCount}/5`);
  const hexinVs = results.map((r) => r.hexinV).filter(Boolean);
  const uniqueCount = new Set(hexinVs).size;
  console.log(`hexin-v 唯一值数: ${uniqueCount}/${hexinVs.length}（含时间因子，每次不同为正常）`);
  console.log(`hexin-v 长度: ${hexinVs[0]?.length}`);

  // chameleon.js 的 setInterval 会阻止进程退出
  process.exit(successCount >= 1 ? 0 : 1);
})();
