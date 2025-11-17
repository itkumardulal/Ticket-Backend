# Use official Node.js image
FROM node:20-slim

# Install system dependencies for sharp + fonts
RUN apt-get update && apt-get install -y \
    libvips-dev \
    libglib2.0-0 \
    libexpat1 \
    libfontconfig1 \
    libfreetype6 \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm rebuild sharp

# Copy all source code
COPY . .

# Start the server
CMD ["node", "src/index.js"]