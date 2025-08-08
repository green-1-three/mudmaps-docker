# --- Build stage ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Inject build-time Vite env
ARG VITE_API_BASE
ARG VITE_OSRM_BASE
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_OSRM_BASE=$VITE_OSRM_BASE

COPY . .
RUN npm run build

# --- Runtime stage ---
FROM nginx:1.27-alpine

# Minimal nginx with gzip and long cache for assets
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
