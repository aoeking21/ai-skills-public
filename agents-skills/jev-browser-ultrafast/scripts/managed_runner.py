import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path.home() / ".local/src/jev-ultrafast-20260923"
PINNED_COMMIT = "1231850a0bf1a0c0341fe408ef1668dbbfdfac46"
VENV_PY = ROOT / ".venv/bin/python"
TYPESAFE_CRED_FILE = Path.home() / ".config/jev-ultrafast/credentials.env"
FALLBACK_ENV_FILE = Path.home() / ".openclaw/.env"
TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_JEV_MODEL = "jev-latest"
DEFAULT_TEXT_MODEL = "deepseek-chat"
GATEWAY = "http://127.0.0.1:4110"
SKILL = "jev-browser-ultrafast"

SENSITIVE_TERMS = {
    "pay", "purchase", "buy", "checkout", "send", "delete", "remove",
    "publish", "post", "submit", "authorize", "approve", "consent",
    "password", "security", "account", "付款", "支付", "购买", "结账",
    "发送", "删除", "发布", "提交", "授权", "批准", "同意", "密码",
    "安全", "账户", "账号", "转账", "提现",
}
def reexec_venv():
    if not VENV_PY.exists():
        return
    try:
        current = Path(sys.executable).resolve()
        expected = VENV_PY.resolve()
    except OSError:
        return
    if current != expected:
        os.execv(str(VENV_PY), [str(VENV_PY), __file__, *sys.argv[1:]])


def read_env_value(path, name):
    if not path.exists():
        return ""
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == name:
            value = value.strip().strip('"').strip("'")
            return value
    return ""


def typesafe_key():
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not key:
        key = read_env_value(TYPESAFE_CRED_FILE, "TYPESAFE_API_KEY").strip()
    if not key:
        raise RuntimeError("TYPESAFE_API_KEY is unavailable; fail closed.")
    if any(ord(ch) < 33 or ord(ch) > 126 for ch in key):
        raise RuntimeError("TYPESAFE_API_KEY has invalid characters.")
    return key


def text_model_config():
    key = os.environ.get("TEXT_MODEL_API_KEY", "").strip()
    base = os.environ.get("TEXT_MODEL_BASE_URL", "").strip()
    model = os.environ.get("JEV_TEXT_MODEL", "").strip()
    if key:
        return key, (base or "https://api.deepseek.com/v1"), (model or DEFAULT_TEXT_MODEL)

    deepseek = read_env_value(FALLBACK_ENV_FILE, "DEEPSEEK_API_KEY").strip()
    if deepseek:
        return deepseek, "https://api.deepseek.com/v1", (model or DEFAULT_TEXT_MODEL)

    openrouter = read_env_value(FALLBACK_ENV_FILE, "OPENROUTER_API_KEY").strip()
    if openrouter:
        return openrouter, "https://openrouter.ai/api/v1", (model or "inception/mercury-2.5")

    raise RuntimeError("No approved text-model credential is available; fail closed.")


def git_commit():
    result = subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True, timeout=10,
    )
    return result.stdout.strip()


def preflight():
    checks = {
        "source_exists": ROOT.is_dir(),
        "venv_python": VENV_PY.exists(),
        "pinned_commit": False,
        "typesafe_credential": False,
        "text_model_credential": False,
        "browser_harness_import": False,
        "central_gateway": False,
    }
    try:
        checks["pinned_commit"] = git_commit() == PINNED_COMMIT
    except (OSError, subprocess.SubprocessError):
        checks["pinned_commit"] = False
    try:
        typesafe_key()
        checks["typesafe_credential"] = True
    except (OSError, RuntimeError):
        checks["typesafe_credential"] = False
    try:
        text_model_config()
        checks["text_model_credential"] = True
    except (OSError, RuntimeError):
        checks["text_model_credential"] = False
    try:
        import browser_harness  # noqa: F401
        checks["browser_harness_import"] = True
    except ImportError:
        checks["browser_harness_import"] = False
    try:
        gateway_health()
        checks["central_gateway"] = True
    except (OSError, RuntimeError, ValueError):
        checks["central_gateway"] = False
    ok = all(checks.values())
    report = {
        "ok": ok,
        "status": "ready" if ok else "blocked",
        "checks": checks,
        "source": str(ROOT),
        "commit": PINNED_COMMIT,
        "decision_model": os.environ.get("JEV_MODEL", DEFAULT_JEV_MODEL),
        "text_model": os.environ.get("JEV_TEXT_MODEL", DEFAULT_TEXT_MODEL),
        "credential_refs": [str(TYPESAFE_CRED_FILE), str(FALLBACK_ENV_FILE)],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if ok else 2


def install_managed_env():
    decision_key = typesafe_key()
    text_key, text_base, text_model = text_model_config()

    os.environ["TYPESAFE_API_KEY"] = decision_key
    os.environ["TYPESAFE_MODEL"] = os.environ.get("JEV_MODEL", DEFAULT_JEV_MODEL)
    os.environ["TEXT_MODEL_API_KEY"] = text_key
    os.environ["TEXT_MODEL_BASE_URL"] = text_base
    os.environ["TEXT_MODEL"] = text_model
    if "api.deepseek.com" in text_base:
        os.environ.pop("TEXT_MODEL_REASONING", None)
    else:
        os.environ.setdefault("TEXT_MODEL_REASONING", "none")

    from jev_ultrafast import model
    original_post_json = model.post_json

    def managed_post_json(url, supplied_key, body):
        if url == TYPESAFE_URL:
            return original_post_json(url, decision_key, body)
        if url.rstrip("/") == text_base.rstrip("/") + "/chat/completions":
            return original_post_json(url, text_key, body)
        raise RuntimeError("Unapproved model endpoint; no action executed.")

    model.post_json = managed_post_json
    return model


def gateway_json(path, payload):
    request = urllib.request.Request(
        GATEWAY + path,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise TypeError("Invalid JEV Central Gateway response.")
    return result


def gateway_health():
    with urllib.request.urlopen(GATEWAY + "/health", timeout=3) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError("JEV Central Gateway is not healthy.")


def pretool(session, goal, page, decision, action):
    action_view = {
        key: action.get(key)
        for key in ("id", "kind", "label", "role", "value", "checked", "selected")
        if key in action
    }
    result = gateway_json("/v1/web/pretool", {
        "toolName": "browser-ultrafast-action",
        "args": {
            "_jev_skill": SKILL,
            "goal": goal,
            "url": page.get("url"),
            "operation": decision.get("operation"),
            "action": action_view,
        },
        "metadata": {
            "clientInfo": {"name": SKILL, "version": "1"},
            "transport": "local-skill-runner",
            "session_id": session,
        },
    })
    if result.get("allowed") is not True:
        reason = result.get("reason") or result.get("decisionReason") or "JEV denied or requires review"
        raise PermissionError(str(reason))
    return result


def posttool(receipt, is_error):
    decision_id = receipt.get("decisionId")
    session_id = receipt.get("sessionId")
    if not decision_id or not session_id:
        raise RuntimeError("JEV approval receipt is incomplete.")
    result = gateway_json("/v1/web/posttool", {
        "decisionId": decision_id,
        "sessionId": session_id,
        "isError": is_error,
    })
    if result.get("ok") is not True:
        raise RuntimeError("JEV PostTool receipt failed.")


def current_host(url):
    return (urlparse(url).hostname or "").lower()


def ensure_host(url, allowed_hosts):
    host = current_host(url)
    if not host or host not in allowed_hosts:
        raise PermissionError(f"Host outside capability lease: {host or '<none>'}")


def sensitive_action(action):
    text = " ".join(
        str(action.get(k, "")) for k in ("label", "kind", "role", "value")
    ).lower()
    return any(term in text for term in SENSITIVE_TERMS)


def confidence_gate(decision, op_floor, target_floor):
    operation = decision.get("operation")
    op_probs = decision.get("operation_probabilities") or {}
    op_probability = float(op_probs.get(operation, 0.0))
    if op_probability < op_floor:
        return False, "low_operation_probability", op_probability
    target = decision.get("target")
    if target is not None:
        target_probs = decision.get("target_probabilities") or {}
        target_probability = float(target_probs.get(target, 0.0))
        if target_probability < target_floor:
            return False, "low_target_probability", target_probability
    return True, "ok", op_probability


def compact_result(agent, status, reason=None, verified=False):
    state = agent.state
    page = state.get("page") or {}
    history = state.get("history") or []
    result = {
        "ok": status == "done" and (verified or not reason),
        "status": status,
        "reason": reason,
        "url": page.get("url"),
        "title": page.get("title"),
        "steps": len(history),
        "elapsed_ms": state.get("elapsed_ms"),
        "central_jev_guarded": True,
        "independent_outcome_verified": verified,
    }
    if history:
        last = history[-1]
        result["last_action"] = {
            "action": last.get("action"),
            "kind": last.get("kind"),
            "page_changed": last.get("page_changed"),
            "probability": last.get("probability"),
        }
    return result


def run_agent(args):
    if git_commit() != PINNED_COMMIT:
        raise RuntimeError("Pinned source changed; fail closed.")
    parsed = urlparse(args.url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeError("Initial URL must be http/https with a hostname.")
    allowed_hosts = {parsed.hostname.lower(), *(host.lower() for host in args.allow_host)}
    install_managed_env()
    gateway_health()
    session = args.session or f"jev-browser-ultrafast:{os.getpid()}"

    from jev_ultrafast.agent import Agent
    from jev_ultrafast.browser import StalePage

    agent = Agent(args.url, args.goal, screenshots=False)
    try:
        for _ in range(args.max_steps):
            ensure_host(agent.state["page"]["url"], allowed_hosts)

            # Independent acceptance evidence is authoritative for completion.
            # Check it before asking the model for another action so a verified
            # goal cannot trigger unnecessary browser mutations.
            if args.expect_text or args.expect_url_contains:
                current_page = agent.state.get("page") or {}
                body_text = agent.browser.evaluate("document.body.innerText") or ""
                haystack = "\n".join([
                    current_page.get("title", ""),
                    current_page.get("url", ""),
                    body_text,
                ])
                text_ok = all(text in haystack for text in args.expect_text)
                url_ok = all(
                    fragment in current_page.get("url", "")
                    for fragment in args.expect_url_contains
                )
                if text_ok and url_ok:
                    result = compact_result(agent, "done", verified=True)
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                    return 0

            try:
                agent.command("predict", {})
            except StalePage:
                agent.state["decision"] = None
                agent.state["status"] = "ready"
                agent.state["page"] = agent.state["browser"].observe(screenshot=False)
                ensure_host(agent.state["page"]["url"], allowed_hosts)
                continue

            decision = agent.state.get("decision") or {}
            selected = decision.get("choice")

            # DONE/BLOCKED are non-mutating terminal judgments. Keep the
            # probability gate on every browser mutation, while allowing
            # independent acceptance evidence to validate DONE safely.
            if selected not in {"DONE", "BLOCKED"}:
                allowed, reason, probability = confidence_gate(
                    decision, args.op_probability, args.target_probability
                )
                if not allowed:
                    result = compact_result(agent, "needs_review", reason)
                    result["observed_probability"] = probability
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                    return 3

            page = agent.state["page"]
            if selected in {"DONE", "BLOCKED"}:
                try:
                    snapshot = agent.command("act", {"fingerprint": page["fingerprint"]})
                except StalePage:
                    agent.state["decision"] = None
                    agent.state["status"] = "ready"
                    agent.state["page"] = agent.state["browser"].observe(screenshot=False)
                    ensure_host(agent.state["page"]["url"], allowed_hosts)
                    continue
            else:
                page_actions = page.get("actions") or []
                action = next((a for a in page_actions if a.get("id") == selected), None)
                if action is None:
                    raise RuntimeError("Selected action is absent from fresh page state.")
                if sensitive_action(action) and not args.allow_sensitive:
                    result = compact_result(agent, "needs_review", "sensitive_action")
                    result["proposed_action"] = action.get("label")
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                    return 3

                receipt = pretool(session, agent.state["goal"], page, decision, action)
                try:
                    snapshot = agent.command("act", {"fingerprint": page["fingerprint"]})
                except StalePage:
                    posttool(receipt, True)
                    agent.state["decision"] = None
                    agent.state["status"] = "ready"
                    agent.state["page"] = agent.state["browser"].observe(screenshot=False)
                    ensure_host(agent.state["page"]["url"], allowed_hosts)
                    continue
                except (OSError, RuntimeError, TypeError, ValueError):
                    posttool(receipt, True)
                    raise
                else:
                    posttool(receipt, False)
                    ensure_host(agent.state["page"]["url"], allowed_hosts)

            status = snapshot.get("status")
            if status in {"done", "blocked"}:
                verified = False
                if status == "done":
                    final_page = agent.state.get("page") or {}
                    criteria_supplied = bool(args.expect_text or args.expect_url_contains)
                    if criteria_supplied:
                        body_text = agent.browser.evaluate("document.body.innerText") or ""
                        haystack = "\n".join([
                            final_page.get("title", ""),
                            final_page.get("url", ""),
                            body_text,
                        ])
                        text_ok = all(text in haystack for text in args.expect_text)
                        url_ok = all(
                            fragment in final_page.get("url", "")
                            for fragment in args.expect_url_contains
                        )
                        verified = text_ok and url_ok
                        if not verified:
                            result = compact_result(
                                agent, "verification_failed", "acceptance_evidence_missing", False
                            )
                            print(json.dumps(result, ensure_ascii=False, indent=2))
                            return 5
                result = compact_result(agent, status, verified=verified)
                print(json.dumps(result, ensure_ascii=False, indent=2))
                return 0 if status == "done" else 4

        result = compact_result(agent, "blocked", "managed_step_budget")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 4
    finally:
        agent.close()


def parser():
    p = argparse.ArgumentParser(description="JEV-managed jev-ultrafast runner")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("preflight")

    run = sub.add_parser("run")
    run.add_argument("--url", required=True)
    run.add_argument("--goal", required=True)
    run.add_argument("--max-steps", type=int, default=20)
    run.add_argument("--op-probability", type=float, default=0.60)
    run.add_argument("--target-probability", type=float, default=0.55)
    run.add_argument("--allow-sensitive", action="store_true")
    run.add_argument("--allow-host", action="append", default=[])
    run.add_argument("--session", default="")
    run.add_argument("--expect-text", action="append", default=[])
    run.add_argument("--expect-url-contains", action="append", default=[])
    return p


def main():
    reexec_venv()
    args = parser().parse_args()
    try:
        if args.command == "preflight":
            return preflight()
        if not (1 <= args.max_steps <= 40):
            raise RuntimeError("max_steps must be between 1 and 40.")
        if not (0.5 <= args.op_probability <= 1.0):
            raise RuntimeError("op_probability must be between 0.5 and 1.0.")
        if not (0.5 <= args.target_probability <= 1.0):
            raise RuntimeError("target_probability must be between 0.5 and 1.0.")
        return run_agent(args)
    except PermissionError as exc:
        print(json.dumps({
            "ok": False,
            "status": "jev_denied",
            "error": str(exc),
        }, ensure_ascii=False, indent=2))
        return 3
    except (OSError, RuntimeError, TypeError, ValueError, subprocess.SubprocessError) as exc:
        print(json.dumps({
            "ok": False,
            "status": "error",
            "error": str(exc),
        }, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
