FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source and build.
COPY . .

RUN npm run build

EXPOSE 5173

# Default: serve the built SPA. docker-compose overrides for test.
CMD ["npm", "run", "preview"]
