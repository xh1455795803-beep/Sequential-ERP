# Multi-stage build for Platform Hub
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim
WORKDIR /app

# Runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local
COPY app ./app
COPY requirements.txt .
COPY .env.example ./.env.example

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATABASE_URL="sqlite:////data/platform_hub.db" \
    APP_PORT=8787 \
    ENCRYPTION_KEY="please-change-me-32-bytes-minimum!!"

EXPOSE 8787

# Volumes for DB and logs
RUN mkdir -p /data /logs
VOLUME ["/data", "/logs"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8787/healthz || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
