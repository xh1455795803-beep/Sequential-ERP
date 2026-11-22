import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .routers import catalog, order, config, ops, finance

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(BASE, "frontend")

app = FastAPI(title="塔奥 thalvior · 多店铺电商 ERP", version="1.0.0",
              description="多平台多店铺统一管理 · 核心履约闭环演示系统")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
for r in (catalog.router, order.router, config.router, ops.router, finance.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    return {"status": "ok", "product": "塔奥 thalvior", "version": "1.0.0"}


app.mount("/vendor", StaticFiles(directory=os.path.join(FRONTEND, "vendor")), name="vendor")
app.mount("/static", StaticFiles(directory=os.path.join(FRONTEND, "static")), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(FRONTEND, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8801, log_level="info")
