FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY server.js ./
ENV NODE_ENV=production
CMD ["node", "server.js"]