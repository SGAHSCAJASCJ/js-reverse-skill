"""
Python TLS 指纹兼容客户端模板

支持三种客户端（按优先级）：
    1. curl_cffi（impersonate Chrome/Firefox，JA3/JA4/Akamai 对齐最完善）
    2. cffi_curl（curl_cffi 的 CFFI 封装，性能更好）
    3. cyCronet（基于 Chromium Cronet，HTTP/2 + QUIC 支持）

硬性要求：
    - Session 模式：同一 session 复用 Cookie jar / TLS 上下文
    - final.py 中必须使用 create_request_session + try-finally close
    - 不得使用普通 requests / httpx / urllib3 发送最终业务请求
    - 仅用于授权范围内的少量最终验证请求，不用于批量访问
    - 【默认强制】默认向真实 API 发请求验证（≥5 次交叉验证），仅当用户明确说"只输出参数"时才用 --sign-only 跳过
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 客户端检测：按优先级选择可用的 TLS 兼容客户端
# ============================================================
def detect_available_client() -> str:
    """检测可用的 TLS 指纹兼容客户端，返回客户端名称。"""
    # 1. curl_cffi（推荐）
    try:
        from curl_cffi import requests as curl_requests  # noqa: F401
        return "curl_cffi"
    except ImportError:
        pass

    # 2. cffi_curl
    # 注意: cffi_curl 这个包名可能不存在于 PyPI,通常需要手动安装或从源码编译。
    # 若不可用,可改用 curl_cffi 作为替代(上面的分支已检测 curl_cffi)。
    try:
        import cffi_curl  # noqa: F401
        return "cffi_curl"
    except ImportError:
        pass

    # 3. cyCronet
    try:
        import cyCronet  # noqa: F401
        return "cyCronet"
    except ImportError:
        pass

    raise ImportError(
        "未检测到 TLS 指纹兼容客户端，请安装其一：\n"
        "  pip install curl_cffi   # 推荐\n"
        "  pip install cffi_curl\n"
        "  pip install cyCronet"
    )


# ============================================================
# CookieJar：与 Node 版 client.js 的 CookieJar 接口对齐
# ============================================================
class CookieJar:
    """
    简易 Cookie Jar，与 templates/node-request/client.js 的 CookieJar 接口对齐。

    提供：
        - set(name, value, domain='')            添加/覆盖单条 cookie
        - get(name, domain='')                   读取单条 cookie 值
        - merge(set_cookie_headers, domain='')   从 Set-Cookie 响应头批量合并
        - to_string(domain='')                   生成请求 Cookie 头字符串
        - to_dict(domain='')                     转为 dict（用于调试）
        - cookies                                属性：Dict[str, dict] 存储

    与 Node 版差异：
        - Python 版 cookies 是 dict（key = "domain:name"），Node 版是 Map
        - length 用 len(jar)，Node 版用 .size
    """

    def __init__(self) -> None:
        # key: "domain:name", value: {"value": str, "domain": str}
        self.cookies: Dict[str, Dict[str, str]] = {}

    def set(self, name: str, value: str, domain: str = "") -> None:
        self.cookies[f"{domain}:{name}"] = {"value": value, "domain": domain}

    def get(self, name: str, domain: str = "") -> Optional[str]:
        entry = self.cookies.get(f"{domain}:{name}")
        return entry["value"] if entry else None

    def merge(self, set_cookie_headers: Any, domain: str = "") -> None:
        """从响应头 set-cookie（单条 str 或 List[str]）批量合并。"""
        if not set_cookie_headers:
            return
        if isinstance(set_cookie_headers, (list, tuple)):
            items: List[str] = list(set_cookie_headers)
        else:
            items = [str(set_cookie_headers)]

        for item in items:
            # set-cookie 头形如: "name=value; Path=/; HttpOnly; ..."
            pair = item.split(";")[0].strip()
            if "=" not in pair:
                continue
            name, value = pair.split("=", 1)
            name = name.strip()
            value = value.strip()
            if name:
                self.set(name, value, domain)

    def to_string(self, domain: str = "") -> str:
        """生成请求 Cookie 头字符串（与 Node 版 toString 对齐）。"""
        items: List[str] = []
        for key, c in self.cookies.items():
            if not domain or c["domain"] == domain or key.endswith(f":{domain}"):
                # key 形如 "domain:name"，取冒号后的 name
                name = key.split(":", 1)[-1]
                items.append(f"{name}={c['value']}")
        return "; ".join(items)

    def to_dict(self, domain: str = "") -> Dict[str, str]:
        result: Dict[str, str] = {}
        for key, c in self.cookies.items():
            if not domain or c["domain"] == domain or key.endswith(f":{domain}"):
                name = key.split(":", 1)[-1]
                result[name] = c["value"]
        return result

    def __len__(self) -> int:
        return len(self.cookies)

    def __repr__(self) -> str:
        return f"CookieJar({len(self)} cookies)"


# ============================================================
# Session 工厂：创建 TLS 指纹兼容会话
# ============================================================
def create_request_session(
    impersonate: str = "chrome135",
    user_agent: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    proxy: Optional[str] = None,
    follow_redirects: bool = True,
    timeout: int = 30,
) -> "RequestSession":
    """
    创建请求 Session。

    Args:
        impersonate: 目标浏览器指纹（curl_cffi 支持 chrome/firefox/safari 等）
        user_agent: 自定义 UA（必须与签名用 UA 一致）
        headers: 默认 Header
        proxy: 代理地址
        follow_redirects: 是否跟随重定向
        timeout: 超时秒数

    Returns:
        RequestSession 实例
    """
    client_name = detect_available_client()

    final_headers = {
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if headers:
        final_headers.update(headers)
    if user_agent:
        final_headers["User-Agent"] = user_agent

    if client_name == "curl_cffi":
        from curl_cffi import requests as curl_requests

        session = curl_requests.Session(
            impersonate=impersonate,
            headers=final_headers,
            proxies={"http": proxy, "https": proxy} if proxy else None,
            timeout=timeout,
            allow_redirects=follow_redirects,
        )
        return RequestSession(session, client_name, impersonate)

    elif client_name == "cffi_curl":
        import cffi_curl

        session = cffi_curl.Session(
            impersonate=impersonate,
            headers=final_headers,
            proxy=proxy,
            follow_redirects=follow_redirects,
            timeout=timeout,
        )
        return RequestSession(session, client_name, impersonate)

    else:  # cyCronet
        import cyCronet

        session = cyCronet.Session(
            headers=final_headers,
            proxy=proxy,
            follow_redirects=follow_redirects,
            timeout=timeout,
        )
        return RequestSession(session, client_name, impersonate)


# ============================================================
# RequestSession 包装类（统一接口）
# ============================================================
class RequestSession:
    """统一封装三种 TLS 兼容客户端，对外暴露 request/get/post 方法。"""

    def __init__(self, raw_session, client_name: str, impersonate: str):
        self._raw = raw_session
        self._client_name = client_name
        self._impersonate = impersonate
        self._closed = False

    @property
    def client_name(self) -> str:
        return self._client_name

    @property
    def impersonate(self) -> str:
        return self._impersonate

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Optional[Dict[str, str]] = None,
        params: Optional[Dict[str, Any]] = None,
        data: Any = None,
        json_body: Any = None,
        timeout: Optional[int] = None,
    ) -> "Response":
        """发送请求。"""
        if self._closed:
            raise RuntimeError("Session 已关闭")

        kwargs: Dict[str, Any] = {}
        if headers:
            kwargs["headers"] = headers
        if params:
            kwargs["params"] = params
        if data is not None:
            kwargs["data"] = data
        if json_body is not None:
            kwargs["json"] = json_body
        if timeout is not None:
            kwargs["timeout"] = timeout

        raw_res = self._raw.request(method.upper(), url, **kwargs)
        return Response(raw_res)

    def get(self, url: str, **kwargs) -> "Response":
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> "Response":
        return self.request("POST", url, **kwargs)

    def close(self):
        """关闭 Session，释放 TLS 上下文和连接池。"""
        if not self._closed:
            try:
                self._raw.close()
            except Exception as e:
                logger.warning(f"关闭 session 异常: {e}")
            self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# ============================================================
# Response 包装类
# ============================================================
class Response:
    """统一封装响应，对外暴露 status/headers/body/text/json。"""

    def __init__(self, raw_response):
        self._raw = raw_response
        self.status_code: int = getattr(raw_response, "status_code", 0)
        self.headers: Dict[str, str] = dict(getattr(raw_response, "headers", {}))
        self._body: bytes = getattr(raw_response, "content", b"") or b""
        self._text_cache: Optional[str] = None

    @property
    def body(self) -> bytes:
        return self._body

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def text(self, encoding: str = "utf-8") -> str:
        if self._text_cache is None:
            self._text_cache = self._body.decode(encoding, errors="replace")
        return self._text_cache

    def json(self) -> Any:
        return json.loads(self.text())


# ============================================================
# 使用示例（在 final.py 中引用）
# ============================================================
#
# from client import create_request_session, CookieJar
#
# def main():
#     session = create_request_session(
#         impersonate="chrome135",
#         user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
#     )
#     jar = CookieJar()
#     try:
#         # 1. 访问主页刷新 Cookie
#         home = session.get("https://example.com/")
#         jar.merge(home.headers.get("set-cookie"))
#
#         # 2. 调用前置接口（带 cookie）
#         init = session.get(
#             "https://example.com/api/init",
#             headers={"Cookie": jar.to_string()},
#         )
#         jar.merge(init.headers.get("set-cookie"))
#         secret_key = init.json().get("secretKey")
#
#         # 3. 生成签名
#         sign = generate_sign({"ts": int(time.time() * 1000)}, secret_key)
#
#         # 4. 发送目标请求
#         res = session.get(
#             "https://example.com/api/search",
#             headers={"x-sign": sign, "Cookie": jar.to_string()},
#         )
#         print(res.json())
#     finally:
#         session.close()
#
# if __name__ == "__main__":
#     main()


if __name__ == "__main__":
    # 自检：检测可用客户端
    try:
        name = detect_available_client()
        print(f"检测到可用 TLS 客户端：{name}")
        # CookieJar 烟雾测试
        jar = CookieJar()
        jar.merge(["sessionid=abc123; Path=/", "token=xyz; HttpOnly"])
        print(f"CookieJar 测试: {jar} -> {jar.to_string()!r}")
    except ImportError as e:
        print(str(e))
