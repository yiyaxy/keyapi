"""
NoteRx 后端入口
"""
import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import FastAPI, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse

from app.api.routes import router as api_router
from app import local_memory
from app.agents.base_agent import llm_api_key_var, llm_base_url_var, llm_model_var

FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
SPA_BASE_PATH = "/noterx"
LEGACY_SPA_BASE_PATH = "/app"

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "baseline.db")


def _ensure_history_table():
    """启动时自动创建 NoteRx 本地 SQLite 表（如不存在）。"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            title_length INTEGER,
            content TEXT,
            tags TEXT,
            publish_hour INTEGER,
            likes INTEGER DEFAULT 0,
            collects INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            followers INTEGER DEFAULT 0,
            is_viral INTEGER DEFAULT 0,
            cover_has_face INTEGER DEFAULT 0,
            cover_text_ratio REAL DEFAULT 0,
            cover_saturation REAL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS baseline_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            metric_name TEXT NOT NULL,
            metric_value REAL,
            metric_json TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(category, metric_name)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notes_viral ON notes(category, is_viral)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS diagnosis_history (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            overall_score REAL,
            grade TEXT,
            report_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_history_created
        ON diagnosis_history(created_at DESC)
    """)
    # Usage tracking table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS usage_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            action TEXT NOT NULL DEFAULT 'diagnose',
            title TEXT DEFAULT '',
            category TEXT DEFAULT '',
            total_tokens INTEGER DEFAULT 0,
            duration_sec REAL DEFAULT 0,
            status TEXT DEFAULT 'ok',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_ip ON usage_log(ip)")
    conn.commit()
    conn.close()
    local_memory.ensure_memory_md()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """应用生命周期：启动时自动建表"""
    _ensure_history_table()
    yield

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

app = FastAPI(
    title="NoteRx API",
    description="AI驱动的小红书笔记诊断平台",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://noterx.muran.tech",
        "http://localhost:5173",
        "http://localhost:5174",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def extract_llm_headers(request: Request, call_next):
    """提取前端传入的动态 LLM 配置，供整个请求上下文使用"""
    resets = []
    api_key = request.headers.get("x-llm-api-key")
    if api_key:
        resets.append((llm_api_key_var, llm_api_key_var.set(api_key)))
    base_url = request.headers.get("x-llm-base-url")
    if base_url:
        resets.append((llm_base_url_var, llm_base_url_var.set(base_url)))
    model = request.headers.get("x-llm-model")
    if model:
        resets.append((llm_model_var, llm_model_var.set(model)))
        
    try:
        response = await call_next(request)
        if response.headers.get("content-type", "").startswith("text/event-stream"):
            resets = []
        return response
    finally:
        for var, token in reversed(resets):
            var.reset(token)


def _safe_callback_path(request: Request, callback_url: str | None) -> str:
    if not callback_url:
        return "/noterx"

    parsed = urlsplit(callback_url)
    if parsed.scheme or parsed.netloc:
        request_origin = f"{request.url.scheme}://{request.url.netloc}"
        callback_origin = f"{parsed.scheme}://{parsed.netloc}"
        if callback_origin != request_origin:
            return "/noterx"

    path = parsed.path or "/noterx"
    if not path.startswith("/") or path.startswith("//"):
        return "/noterx"
    return urlunsplit(("", "", path, parsed.query, parsed.fragment))


def _append_token_to_callback(callback_path: str, token: str) -> str:
    parsed = urlsplit(callback_path)
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key not in {"token", "key"}
    ]
    if token:
        query.append(("token", token))
    return urlunsplit(("", "", parsed.path or "/noterx", urlencode(query), parsed.fragment))


@app.get("/api/auth/token-login")
@app.get(f"{SPA_BASE_PATH}/api/auth/token-login")
@app.get(f"{LEGACY_SPA_BASE_PATH}/api/auth/token-login")
async def token_login_get(request: Request, token: str = "", callbackUrl: str = ""):
    target = _append_token_to_callback(_safe_callback_path(request, callbackUrl), token.strip())
    return RedirectResponse(target, status_code=303)


@app.post("/api/auth/token-login")
@app.post(f"{SPA_BASE_PATH}/api/auth/token-login")
@app.post(f"{LEGACY_SPA_BASE_PATH}/api/auth/token-login")
async def token_login_post(
    request: Request,
    token: str = Form(default=""),
    callbackUrl: str = Form(default=""),
):
    target = _append_token_to_callback(_safe_callback_path(request, callbackUrl), token.strip())
    return RedirectResponse(target, status_code=303)

app.include_router(api_router, prefix="/api")
app.include_router(api_router, prefix=f"{SPA_BASE_PATH}/api")
app.include_router(api_router, prefix=f"{LEGACY_SPA_BASE_PATH}/api")

# Admin panel at /admin (no /api prefix)
from app.api.admin_api import router as admin_router
app.include_router(admin_router)

# ── Landing page: research whitepaper at / ──
RESEARCH_HTML = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "research_whitepaper.html")

@app.get("/")
async def serve_landing():
    """首页 → 研究白皮书着陆页"""
    if os.path.isfile(RESEARCH_HTML):
        return FileResponse(RESEARCH_HTML, media_type="text/html")
    # Fallback: serve SPA if whitepaper not found
    if os.path.isdir(FRONTEND_DIST):
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
    return {"status": "ok", "service": "NoteRx API"}

@app.get("/research")
async def serve_research():
    """兼容旧链接"""
    if os.path.isfile(RESEARCH_HTML):
        return FileResponse(RESEARCH_HTML, media_type="text/html")
    return {"error": "Research page not found"}

# ── Legal pages ──
TERMS_HTML = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "terms.html")
PRIVACY_HTML = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "privacy.html")

@app.get("/terms")
async def serve_terms():
    """服务条款"""
    if os.path.isfile(TERMS_HTML):
        return FileResponse(TERMS_HTML, media_type="text/html")
    return {"error": "Terms page not found"}

@app.get("/privacy")
async def serve_privacy():
    """隐私政策"""
    if os.path.isfile(PRIVACY_HTML):
        return FileResponse(PRIVACY_HTML, media_type="text/html")
    return {"error": "Privacy page not found"}

# ── SPA: product app at /noterx and sub-routes ──
if os.path.isdir(FRONTEND_DIST):
    from starlette.middleware.base import BaseHTTPMiddleware

    class SPAMiddleware(BaseHTTPMiddleware):
        """Serve SPA index.html for NoteRx client-side routes."""
        async def dispatch(self, request, call_next):
            response = await call_next(request)
            path = request.url.path
            if (response.status_code == 404
                    and not path.startswith("/api")
                    and not path.startswith(f"{SPA_BASE_PATH}/api")
                    and not path.startswith(f"{LEGACY_SPA_BASE_PATH}/api")
                    and not path.startswith("/assets")
                    and not path.startswith(f"{SPA_BASE_PATH}/assets")
                    and path not in ("/", "/research", "/terms", "/privacy")
                    and not path.startswith("/admin")
                    and (path == SPA_BASE_PATH
                         or path.startswith(f"{SPA_BASE_PATH}/")
                         or path == LEGACY_SPA_BASE_PATH
                         or path.startswith(f"{LEGACY_SPA_BASE_PATH}/"))):
                return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
            return response

    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="static")
    app.mount(
        f"{SPA_BASE_PATH}/assets",
        StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")),
        name="noterx-static",
    )
    app.add_middleware(SPAMiddleware)

    @app.get(SPA_BASE_PATH)
    @app.get(f"{SPA_BASE_PATH}/")
    @app.get(LEGACY_SPA_BASE_PATH)
    async def serve_app():
        """产品主页面"""
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))


    @app.get(f"{SPA_BASE_PATH}/favicon.svg")
    async def serve_noterx_favicon():
        return FileResponse(os.path.join(FRONTEND_DIST, "favicon.svg"), media_type="image/svg+xml")

    @app.get(f"{SPA_BASE_PATH}/icons.svg")
    async def serve_noterx_icons():
        return FileResponse(os.path.join(FRONTEND_DIST, "icons.svg"), media_type="image/svg+xml")


@app.get("/api/health")
async def health():
    """详细健康检查，含数据库探测"""
    import sqlite3
    import os
    db_path = os.path.join(os.path.dirname(__file__), "..", "data", "baseline.db")
    db_ok = False
    note_count = 0
    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM notes")
        note_count = cur.fetchone()[0]
        conn.close()
        db_ok = True
    except Exception:
        pass
    return {
        "status": "ok" if db_ok else "degraded",
        "database": {"connected": db_ok, "note_count": note_count},
    }
