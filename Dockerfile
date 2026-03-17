# Gunakan image resmi Bun
FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Install Chromium & dependencies untuk Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libxss1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libatk1.0-0 \
    libdrm2 \
    ca-certificates \
    fonts-liberation \
    wget \
    unzip \
 && rm -rf /var/lib/apt/lists/*

 # Tambahkan ini
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Salin package.json dan bun.lockb untuk caching
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install

# Salin semua source code
COPY . .

# Volume untuk session WhatsApp
# VOLUME ["/app/data"]

# Jalankan Hono dengan hot reload
# CMD ["bun", "run", "--hot", "src/index.ts"]
# CMD ["bun", "run", "start"]

# Build
RUN bun run build

# Run Hasil Build
CMD ["bun", "dist/index.js"]
