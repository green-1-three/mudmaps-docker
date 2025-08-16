# Stage 1: Build Vite frontend
FROM node:20-alpine AS builder

WORKDIR /app
COPY . .

RUN npm install
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy static assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Use your custom HTTPS nginx.conf
COPY ../nginx.conf /etc/nginx/conf.d/default.conf