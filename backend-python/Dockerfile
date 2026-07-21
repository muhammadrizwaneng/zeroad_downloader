FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YTDLP_POT_PROVIDER_URL=http://127.0.0.1:4416

ARG BGUTIL_VERSION=1.3.1

# ffmpeg + Node.js (bgutil POT provider) + yt-dlp + plugin
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg curl ca-certificates git unzip \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && mkdir -p /root/.config/yt-dlp/plugins \
    && curl -L "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_VERSION}/bgutil-ytdlp-pot-provider.zip" \
        -o /tmp/bgutil-plugin.zip \
    && unzip /tmp/bgutil-plugin.zip -d /root/.config/yt-dlp/plugins/ \
    && git clone --single-branch --branch "${BGUTIL_VERSION}" --depth 1 \
        https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server && npm ci && npx tsc \
    && rm -rf /var/lib/apt/lists/* /tmp/bgutil-plugin.zip

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ytdlp_service.py start.sh ./
RUN chmod +x start.sh

CMD ["./start.sh"]
