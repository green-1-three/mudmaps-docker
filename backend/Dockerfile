FROM node:20-alpine
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --only=production
COPY backend/ ./
COPY shared/ ./shared/
ENV NODE_ENV=production
CMD ["node", "index.js"]