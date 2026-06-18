FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV CHROME_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY herramientas ./herramientas

RUN mkdir -p salida-notion-pdf/web

EXPOSE 4173

CMD ["npm", "start"]
