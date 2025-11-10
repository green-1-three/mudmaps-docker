FROM node:20-alpine
WORKDIR /app
COPY tcp-listener/package.json tcp-listener/package-lock.json ./
RUN npm ci --omit=dev
COPY tcp-listener/tcp-listener.js ./
COPY shared/ ./shared/
ENV NODE_ENV=production
EXPOSE 5500
CMD ["node", "tcp-listener.js"]