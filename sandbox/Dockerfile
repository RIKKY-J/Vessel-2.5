FROM node:20-bookworm

# Install build tools, native dependencies, and common terminal utilities
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    bash \
    curl \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create workspace directory for user code
RUN mkdir -p /workspace

# Set the working directory for the runner daemon
WORKDIR /code

# Copy package descriptors
COPY package*.json ./

# Install dependencies (rebuilding any native addons like node-pty)
RUN npm install

# Copy application source
COPY . .

# Allocate memory for TypeScript compilation and build
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npm run build

# Expose user app (3000) and runner daemon (3001)
EXPOSE 3000 3001

# Start runner daemon
CMD [ "node", "dist/index.js" ]
