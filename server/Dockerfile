FROM node:20-slim AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/ ./shared/
COPY server/package.json ./server/

RUN npm install --workspace=server --include-workspace-root

COPY server/ ./server/

EXPOSE 3001

CMD npm run start -w server
