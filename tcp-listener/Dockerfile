FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY tcp-listener.js ./
ENV NODE_ENV=production
EXPOSE 5500
CMD ["node", "tcp-listener.js"]