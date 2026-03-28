FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production=false

# Copy source code
COPY . .

# Create exports directory
RUN mkdir -p exports

# Expose port
EXPOSE 3000

# Start server
CMD ["npx", "tsx", "src/server.ts"]
