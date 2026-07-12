#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ruyiPage 通用取证脚本

目标：消除"每个 case 手写 ruyiPage 取证脚本"的重复劳动与 API 踩坑。
任何 ruyiPage 取证都应优先运行本脚本，而不是从示例片段重新拼装。

严格遵循 references/tooling/ruyi-tooling.md 的"ruyiPage 启动硬约束"：
  - 必须显式使用已验证的 ruyiPage 定制 Firefox（禁止系统 Firefox 回退）
  - 有头模式（无 --headless 选项，本身就是硬约束）
  - 独立 case 专用 profile
  - smart_fingerprint + apply_emulation
  - page.capture.start(...) 必须在 page.get(...) 之前执行
  - 导航后自检 navigator.webdriver === false
  - 抓所有包（targets=True），事后从 steps 过滤，避免漏掉 JS 文件

正确 API（基于 ruyipage 1.2.45 内省确认）：
  - page.capture.start(targets=True, collect_bodies=True)  # True=抓全部
  - page.capture.wait(timeout=, count=1)  -> 单个 CapturePacket 或 None
  - page.capture.steps                     -> list[CapturePacket]（全部包）
  - CapturePacket.to_dict(include_bodies=True) -> url/method/headers/status/bodies
  - opts.smart_fingerprint(...) -> FingerprintContext；ctx.apply_emulation(page)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import uuid
from typing import Any, Dict, List, Optional, Tuple

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("forensic_ruyipage")


# ============================================================
# 检测：ruyipage 包 + 定制 Firefox
# ============================================================
def detect_ruyipage() -> Tuple[bool, str, str]:
    try:
        import ruyipage  # noqa: F401
        version = getattr(ruyipage, "__version__", "?")
        return True, version, ""
    except Exception as e:  # pragma: no cover
        return False, "", str(e)


def is_ruyi_custom_firefox(path: str) -> bool:
    """判断 Firefox 路径是否来自 ruyiPage 定制 runtime（禁止系统 Firefox 回退）。"""
    if not path:
        return False
    low = path.lower().replace("\\", "/")
    if "ruyi" in low:
        return True
    runtime_dir = os.path.dirname(path)
    marker = os.path.join(runtime_dir, "install.json")
    if os.path.isfile(marker):
        try:
            with open(marker, "r", encoding="utf-8") as f:
                txt = f.read().lower()
            if "ruyi" in txt:
                return True
        except Exception:
            pass
    return False


def resolve_browser(args: argparse.Namespace) -> Tuple[str, str]:
    """返回 (browser_path, error)。显式路径优先；否则强制 managed runtime（禁系统回退）。"""
    if args.browser_path:
        p = os.path.abspath(os.path.expanduser(args.browser_path))
        if not os.path.isfile(p):
            return "", f"--browser-path 不存在：{p}"
        if not is_ruyi_custom_firefox(p):
            return "", (
                f"提供的 Firefox 不是 ruyiPage 定制内核（路径/install.json 无 ruyi 标识）：{p}\n"
                "ruyiPage 取证禁止回退系统 Firefox；请提供定制 Firefox 路径，"
                "或先 `python -m ruyipage install`。"
            )
        return p, ""

    try:
        import ruyipage
        resolved = ruyipage.resolve_firefox_path(allow_system=False)
    except Exception as e:
        return "", f"resolve_firefox_path(allow_system=False) 失败：{e}"
    if not resolved:
        return "", "未能解析到 ruyiPage 定制 Firefox（已禁用系统回退）。请传 --browser-path 或先安装 runtime。"
    if not is_ruyi_custom_firefox(resolved):
        return "", f"解析到的 Firefox 非定制内核：{resolved}"
    return os.path.abspath(resolved), ""


# ============================================================
# 指纹
# ============================================================
def apply_smart_fingerprint(opts, args: argparse.Namespace):
    """返回 FingerprintContext 或 None（--no-fp 时）。地理探测失败且无 manual_geo 时抛错。"""
    if args.no_fp:
        logger.info("已禁用 smart_fingerprint（--no-fp）。")
        return None
    import ruyipage

    kwargs: Dict[str, Any] = {
        "userdir": args.profile_dir,
        "base_dir": args.fp_dir,
    }
    if args.require_country:
        kwargs["require_country"] = args.require_country
    if args.manual_geo:
        kwargs["manual_geo"] = load_manual_geo(args.manual_geo)

    try:
        return opts.smart_fingerprint(**kwargs)
    except Exception as e:
        msg = str(e)
        if ("geo" in msg.lower() or "country" in msg.lower()) and not args.manual_geo:
            raise RuntimeError(
                "smart_fingerprint 地理探测失败且未提供 manual_geo。\n"
                f"原始错误：{msg}\n"
                "解决：安装 requests（`python -m pip install requests`），"
                "或用 --manual-geo <json或文件路径> 提供地理信息，不要静默跳过智能指纹。"
            )
        raise


def load_manual_geo(value: str) -> Any:
    if os.path.isfile(value):
        with open(value, "r", encoding="utf-8") as f:
            return json.load(f)
    try:
        return json.loads(value)
    except Exception:
        return value


# ============================================================
# JS / target 过滤
# ============================================================
_JS_EXT_RE = re.compile(r"\.js(\?|#|$)", re.IGNORECASE)


def is_js_packet(pkt: Dict[str, Any]) -> bool:
    url = (pkt.get("url") or "").split("?")[0].split("#")[0]
    if _JS_EXT_RE.search(url):
        return True
    ct = (pkt.get("response_headers") or {}).get("content-type", "") or ""
    return "javascript" in ct.lower() or "ecmascript" in ct.lower()


def match_targets(pkt: Dict[str, Any], substrings: List[str], regexes: List[re.Pattern]) -> bool:
    if not substrings and not regexes:
        return True
    url = pkt.get("url", "") or ""
    text = json.dumps(pkt, ensure_ascii=False)
    for s in substrings:
        if s and (s in url or s in text):
            return True
    for r in regexes:
        if r.search(url) or r.search(text):
            return True
    return False


def _safe_body(body: Any) -> bytes:
    if body is None:
        return b""
    if isinstance(body, bytes):
        return body
    if isinstance(body, str):
        return body.encode("utf-8", "replace")
    return json.dumps(body, ensure_ascii=False).encode("utf-8", "replace")


def sanitize_filename(url: str) -> str:
    base = url.split("?")[0].split("#")[0].rstrip("/").split("/")[-1]
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base) or "script"
    if not base.endswith(".js"):
        base += ".js"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{base}.{digest}"


def extract_sourcemap(body_bytes: bytes) -> Optional[str]:
    try:
        text = body_bytes.decode("utf-8", "replace")
    except Exception:
        return None
    m = re.search(r"//#\s*sourceMappingURL=([^\s]+)", text)
    return m.group(1) if m else None


def _eval_js(page, expr: str) -> Tuple[Any, Optional[str]]:
    try:
        r = page.run_js(expr)
    except Exception as e:
        return None, str(e)
    if isinstance(r, bool):
        return r, None
    if hasattr(r, "value"):
        return r.value, None
    if hasattr(r, "success"):
        return bool(r.success), None
    return r, None


def _trigger_actions(page, args: argparse.Namespace, human: str) -> None:
    if args.scroll:
        try:
            page.scroll(0, int(args.scroll))
            logger.info("已滚动 %s px", args.scroll)
        except Exception as e:
            logger.warning("scroll 失败：%s", e)
    if args.click:
        try:
            ele = page.ele(args.click, timeout=10)
            act = page.actions
            if hasattr(act, "human_click"):
                act.human_click(ele, algorithm=human).perform()
            else:
                act.move_to(ele).click().perform()
            logger.info("已拟人点击 %s", args.click)
        except Exception as e:
            logger.warning("click %s 失败：%s", args.click, e)


# ============================================================
# 主流程
# ============================================================
def build_options(args: argparse.Namespace, browser_path: str):
    import ruyipage
    from ruyipage import FirefoxOptions

    opts = FirefoxOptions()
    opts.set_browser_path(browser_path)
    opts.set_user_dir(args.profile_dir)
    opts.headless(False)
    w, h = (args.window_size or "1366,900").split(",")[:2]
    opts.set_window_size(int(w), int(h))
    opts.set_human_algorithm(args.human_algorithm)
    return opts


def run_forensic(args: argparse.Namespace, browser_path: str) -> Dict[str, Any]:
    import ruyipage
    from ruyipage import FirefoxPage

    opts = build_options(args, browser_path)
    ctx = apply_smart_fingerprint(opts, args)

    logger.info("启动有头 ruyiPage 定制 Firefox 取证：%s", browser_path)
    page = FirefoxPage(opts)
    if ctx is not None:
        applied = ctx.apply_emulation(page)
        logger.info("智能指纹仿真已注入：%s", applied)

    regexes = []
    if args.targets_regex:
        for r in args.targets_regex.split(","):
            r = r.strip()
            if r:
                regexes.append(re.compile(r))

    substrings = [s.strip() for s in (args.targets or "").split(",") if s.strip()]

    # 硬约束：capture.start 必须在 get 之前
    page.capture.start(targets=True, collect_bodies=True)
    logger.info("capture 已启动（targets=True 抓全部包）")

    page.get(args.url, timeout=args.wait + 20)

    if args.manual_pause:
        input("在浏览器中完成登录 / 业务操作后按回车继续取证...")

    _trigger_actions(page, args, args.human_algorithm)

    first = page.capture.wait(timeout=args.wait, count=1)
    if first is None:
        logger.warning("等待 %ss 未捕获到任何包", args.wait)
    else:
        logger.info("已捕获首个包：%s", first.url)

    if args.settle > 0:
        import time
        logger.info("静置 %ss 等待剩余流量...", args.settle)
        time.sleep(args.settle)

    page.capture.stop()
    steps = page.capture.steps

    records_meta: List[Dict[str, Any]] = [p.to_dict(include_bodies=False) for p in steps]
    js_records: List[Dict[str, Any]] = []
    target_hits: List[Dict[str, Any]] = []

    os.makedirs(args.out_dir, exist_ok=True)
    js_dir = os.path.join(args.case_dir, "js", "original")
    os.makedirs(js_dir, exist_ok=True)

    for p in steps:
        d = p.to_dict(include_bodies=True)
        if is_js_packet(d):
            body = _safe_body(d.get("response_body"))
            fname = sanitize_filename(d.get("url", ""))
            fpath = os.path.join(js_dir, fname)
            with open(fpath, "wb") as f:
                f.write(body)
            sm = extract_sourcemap(body)
            js_records.append({
                "url": d.get("url"),
                "status": d.get("response_status"),
                "saved_to": os.path.relpath(fpath, args.out_dir),
                "size": len(body),
                "source_mapping_url": sm,
            })
        if match_targets(d, substrings, regexes):
            body = _safe_body(d.get("response_body"))
            if len(body) > args.max_body_bytes:
                d["response_body"] = body[:args.max_body_bytes].decode("utf-8", "replace") + (
                    f"\n...[truncated, total {len(body)} bytes]"
                )
                d["response_body_truncated"] = True
            else:
                d["response_body"] = body.decode("utf-8", "replace") if body else ""
            rb = _safe_body(d.get("request_body"))
            d["request_body"] = rb.decode("utf-8", "replace") if rb else ""
            target_hits.append(d)

    webdriver_flag, wd_err = _eval_js(page, "return navigator.webdriver === true")
    cookies = []
    try:
        cookies = page.get_cookies(all_info=True)
    except Exception as e:
        logger.warning("读取 Cookie 失败：%s", e)

    # 验收：目标接口非 OPTIONS 的 2xx
    accepted = [
        h for h in target_hits
        if (h.get("response_status") or 0) // 100 == 2 and (h.get("method") or "").upper() != "OPTIONS"
    ]
    only_options = [
        h for h in target_hits
        if (h.get("method") or "").upper() == "OPTIONS" and not accepted
    ]

    baseline_id = args.baseline_id or uuid.uuid5(
        uuid.NAMESPACE_URL, os.path.abspath(args.case_dir)
    ).hex

    fingerprint = None
    if ctx is not None:
        try:
            fingerprint = ctx.to_dict()
        except Exception as e:
            logger.warning("指纹 to_dict 失败：%s", e)

    result = {
        "url": args.url,
        "browserPath": browser_path,
        "profileDir": args.profile_dir,
        "fpDir": args.fp_dir,
        "baselineId": baseline_id,
        "packetCount": len(records_meta),
        "jsFileCount": len(js_records),
        "targetHitCount": len(target_hits),
        "acceptedTargetCount": len(accepted),
        "webdriverTrue": bool(webdriver_flag) if webdriver_flag is not None else None,
        "webdriverCheckError": wd_err,
        "navigatorWebdriverSelfCheck": "FAIL" if webdriver_flag is True else ("PASS" if webdriver_flag is False else "UNKNOWN"),
        "acceptance": "PASS" if (not substrings and not regexes) or accepted else ("PARTIAL" if target_hits and not accepted else "NO_TARGET"),
        "fingerprint": fingerprint,
        "cookies": cookies,
        "jsFiles": js_records,
        "targetHitsSummary": [
            {"url": h.get("url"), "method": h.get("method"), "status": h.get("response_status"), "isFailed": h.get("is_failed")}
            for h in target_hits
        ],
        "onlyOptionsWarning": [h.get("url") for h in only_options],
    }

    # 落盘
    with open(os.path.join(args.out_dir, "capture.json"), "w", encoding="utf-8") as f:
        json.dump(records_meta, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out_dir, "target-hits.json"), "w", encoding="utf-8") as f:
        json.dump(target_hits, f, ensure_ascii=False, indent=2)

    notes_dir = os.path.join(args.case_dir, "notes")
    os.makedirs(notes_dir, exist_ok=True)
    if fingerprint is not None:
        with open(os.path.join(notes_dir, "fingerprint-baseline.json"), "w", encoding="utf-8") as f:
            json.dump({
                "baselineId": baseline_id,
                "browserPath": browser_path,
                "profileDir": args.profile_dir,
                "fpDir": args.fp_dir,
                "createdAt": _now(),
                "fingerprint": fingerprint,
            }, f, ensure_ascii=False, indent=2)

    result["outputs"] = {
        "captureJson": os.path.join(args.out_dir, "capture.json"),
        "targetHitsJson": os.path.join(args.out_dir, "target-hits.json"),
        "jsDir": js_dir,
        "fingerprintBaseline": os.path.join(notes_dir, "fingerprint-baseline.json") if fingerprint is not None else None,
    }
    try:
        page.close()
    except Exception:
        pass
    return result


def _now() -> str:
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")


# ============================================================
# CLI
# ============================================================
def parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="forensic_ruyipage.py",
        description="ruyiPage 通用取证：抓包 + JS 收集 + 指纹基线（严格有头/定制内核）。",
    )
    p.add_argument("--url", required=True, help="目标页面 URL")
    p.add_argument("--browser-path", default="", help="ruyiPage 定制 Firefox 可执行文件；缺省自动解析 managed runtime（禁系统回退）")
    p.add_argument("--case-dir", default="case", help="case 目录，默认 case")
    p.add_argument("--out-dir", default="", help="取证输出目录，默认 <case-dir>/forensic")
    p.add_argument("--profile-dir", default="", help="独立浏览器 profile，默认 <case-dir>/tmp/ruyipage-profile")
    p.add_argument("--fp-dir", default="", help="智能指纹 base_dir，默认 <case-dir>/tmp/fingerprint")
    p.add_argument("--targets", default="", help="目标接口子串过滤（逗号分隔），仅用于报告过滤；抓包始终抓全部")
    p.add_argument("--targets-regex", default="", help="目标接口正则过滤（逗号分隔）")
    p.add_argument("--human-algorithm", default="windmouse", help="拟人算法：windmouse / bezier，默认 windmouse")
    p.add_argument("--window-size", default="1366,900", help="窗口尺寸 wxh，默认 1366,900")
    p.add_argument("--require-country", default="", help="smart_fingerprint require_country；缺省用库默认(US)")
    p.add_argument("--manual-geo", default="", help="地理探测失败时的 manual_geo（JSON 字符串或文件路径）")
    p.add_argument("--no-fp", action="store_true", help="跳过 smart_fingerprint（禁用智能指纹）")
    p.add_argument("--wait", type=int, default=30, help="等待首个包的超时秒，默认 30")
    p.add_argument("--settle", type=int, default=5, help="首个包后静置秒数，默认 5")
    p.add_argument("--max-body-bytes", type=int, default=1048576, help="target-hits 响应体截断阈值，默认 1MB")
    p.add_argument("--click", default="", help="导航后拟人点击的 CSS 选择器")
    p.add_argument("--scroll", type=int, default=0, help="导航后滚动像素数")
    p.add_argument("--manual-pause", action="store_true", help="导航后暂停，等待手动完成登录/业务再继续")
    p.add_argument("--baseline-id", default="", help="指定 baselineId（复用已有指纹基线）")
    p.add_argument("--dry-run", action="store_true", help="只检测环境并打印计划，不启动浏览器")
    p.add_argument("--json", action="store_true", help="输出 JSON")
    p.add_argument("--markdown", action="store_true", help="输出 Markdown（默认）")
    a = p.parse_args(argv)
    if not a.json and not a.markdown:
        a.markdown = True
    a.case_dir = os.path.abspath(a.case_dir)
    a.out_dir = os.path.abspath(a.out_dir) if a.out_dir else os.path.join(a.case_dir, "forensic")
    a.profile_dir = os.path.abspath(a.profile_dir) if a.profile_dir else os.path.join(a.case_dir, "tmp", "ruyipage-profile")
    a.fp_dir = os.path.abspath(a.fp_dir) if a.fp_dir else os.path.join(a.case_dir, "tmp", "fingerprint")
    return a


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    ok, ver, err = detect_ruyipage()
    if not ok:
        msg = (
            "未检测到 ruyipage Python 包，无法执行取证。\n"
            f"错误：{err}\n"
            "请先安装：python -m pip install ruyiPage requests --upgrade"
        )
        if args.json:
            print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False, indent=2))
        else:
            print(msg)
        return 2

    browser_path, berr = resolve_browser(args)
    if berr:
        msg = f"ruyiPage 定制 Firefox 校验未通过：\n{berr}"
        if args.json:
            print(json.dumps({"ok": False, "error": msg, "ruyipageVersion": ver}, ensure_ascii=False, indent=2))
        else:
            print(msg)
        return 2

    plan = {
        "ruyipageVersion": ver,
        "browserPath": browser_path,
        "url": args.url,
        "outDir": args.out_dir,
        "profileDir": args.profile_dir,
        "fpDir": args.fp_dir,
        "headless": False,
        "humanAlgorithm": args.human_algorithm,
        "smartFingerprint": not args.no_fp,
        "targets": [s for s in args.targets.split(",") if s.strip()],
        "dryRun": args.dry_run,
    }

    if args.dry_run:
        out = {"ok": True, "plan": plan}
        if args.json:
            print(json.dumps(out, ensure_ascii=False, indent=2))
        else:
            print("# ruyiPage 取证计划（dry-run，不启动浏览器）")
            for k, v in plan.items():
                print(f"- {k}: {v}")
        return 0

    result = run_forensic(args, browser_path)
    result["ok"] = True
    result["ruyipageVersion"] = ver

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(result))
    return 0


def render_markdown(r: Dict[str, Any]) -> str:
    L = ["# ruyiPage 取证报告", ""]
    L.append(f"- 目标：{r.get('url')}")
    L.append(f"- ruyipage 版本：{r.get('ruyipageVersion')}")
    L.append(f"- 浏览器：{r.get('browserPath')}")
    L.append(f"- baselineId：{r.get('baselineId')}")
    L.append(f"- 抓包总数：{r.get('packetCount')}")
    L.append(f"- JS 文件数：{r.get('jsFileCount')}")
    L.append(f"- 目标命中数：{r.get('targetHitCount')}（验收通过 {r.get('acceptedTargetCount')}）")
    L.append(f"- navigator.webdriver 自检：{r.get('navigatorWebdriverSelfCheck')}")
    L.append(f"- 取证验收：{r.get('acceptance')}")
    if r.get("onlyOptionsWarning"):
        L.append(f"- ⚠️ 仅捕获到 OPTIONS 预检，未捕获真实业务响应：{r['onlyOptionsWarning']}")
    if r.get("webdriverCheckError"):
        L.append(f"- webdriver 检查错误：{r['webdriverCheckError']}")
    L.append("")
    L.append("## 目标接口命中")
    if r.get("targetHitsSummary"):
        for h in r["targetHitsSummary"]:
            L.append(f"- `{h.get('method')} {h.get('status')}` {h.get('url')}")
    else:
        L.append("- 无（未指定 --targets 或没有命中）")
    L.append("")
    L.append("## JS 文件")
    if r.get("jsFiles"):
        for j in r["jsFiles"]:
            extra = f"  sourceMappingURL={j['source_mapping_url']}" if j.get("source_mapping_url") else ""
            L.append(f"- {j.get('saved_to')} ({j.get('size')}B){extra}  {j.get('url')}")
    else:
        L.append("- 无")
    L.append("")
    L.append("## 输出")
    out = r.get("outputs", {})
    L.append(f"- 全部抓包：{out.get('captureJson')}")
    L.append(f"- 目标命中：{out.get('targetHitsJson')}")
    L.append(f"- JS 目录：{out.get('jsDir')}")
    if out.get("fingerprintBaseline"):
        L.append(f"- 指纹基线：{out.get('fingerprintBaseline')}")
    L.append("")
    if r.get("navigatorWebdriverSelfCheck") == "FAIL":
        L.append("⚠️ navigator.webdriver 为 true，本次取证不合格（疑似被识别为自动化）。")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.exit(main())
