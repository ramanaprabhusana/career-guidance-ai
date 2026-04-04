FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production=false

# Copy source code
COPY . .

# Create exports and data (SQLite profile store)
RUN mkdir -p exports data

# Expose port
EXPOSE 3000

# Start server
CMD ["npx", "tsx", "src/server.ts"]
