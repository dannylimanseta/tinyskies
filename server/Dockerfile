FROM node:20-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/ ./shared/
COPY server/package.json ./server/

RUN npm install --workspace=server --include-workspace-root

COPY server/ ./server/

RUN npx prisma generate --schema=./server/prisma/schema.prisma

EXPOSE 3001

CMD npx prisma migrate deploy --schema=./server/prisma/schema.prisma && npm run start -w server
