FROM node:20-alpine

WORKDIR /app

# Copy only the TCP listener script into the container
COPY tcp-listener.js ./

# Expose the listener port (will be set via env var, default 5000)
EXPOSE 5500

# Run the TCP listener
CMD ["node", "tcp-listener.js"]
