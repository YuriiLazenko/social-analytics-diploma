# syntax=docker/dockerfile:1.6
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Спочатку копіюємо лише маніфести — кеш npm не інвалідовуватиметься на правки коду
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend

WORKDIR /app/backend

EXPOSE 3000

CMD ["node", "src/index.js"]
