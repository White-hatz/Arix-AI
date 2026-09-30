# ========================================================
# Dockerfile for Arix AI (Full Stack: Python 3.11 + Node 20)
# ========================================================

FROM python:3.11-slim

# Avoid prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=5173 \
    ARIX_HOST=0.0.0.0 \
    ARIX_PORT=8765 \
    VITE_HOST=0.0.0.0

# Install system utilities and Node.js 20 LTS
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    build-essential \
    git \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Step 1: Install Backend Python dependencies (cached layer)
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r backend/requirements.txt

# Step 2: Install Frontend Node dependencies (cached layer)
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --legacy-peer-deps

# Step 3: Copy full source tree
COPY . .

# Ensure entrypoint script has execution permissions and LF line endings
RUN chmod +x ./scripts/docker-entrypoint.sh \
    && sed -i 's/\r$//' ./scripts/docker-entrypoint.sh

# Expose Web UI (5173) and Backend API (8765)
EXPOSE 5173 8765

# Start services
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
