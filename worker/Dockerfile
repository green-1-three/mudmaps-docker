FROM node:18-alpine

WORKDIR /app

COPY worker/package*.json ./
RUN npm install --production

COPY worker/ ./
COPY shared/ ./shared/

CMD ["node", "index.js"]
