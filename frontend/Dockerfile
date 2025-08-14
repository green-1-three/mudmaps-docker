# build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# default to /api so the SPA calls the proxy; can be overridden at build time
ARG VITE_API_BASE=/api
ARG VITE_OSRM_BASE=/osrm
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_OSRM_BASE=$VITE_OSRM_BASE
RUN npm run build

# serve
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html