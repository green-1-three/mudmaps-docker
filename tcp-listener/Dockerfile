FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY tcp-listener.js ./

CMD ["node", "tcp-listener.js"]