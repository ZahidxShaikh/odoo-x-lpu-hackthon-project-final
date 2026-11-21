# Production image for the React/Vite frontend and FastAPI backend.
FROM node:22-bookworm-slim

WORKDIR /app

# The backend runs on Python; the frontend is built with Node.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN npm install

COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    DATABASE_PATH=/var/data/champions_club.db

RUN mkdir -p /var/data

# Render (and other PaaS providers) supply PORT at runtime.
CMD ["sh", "-c", "python3 -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
