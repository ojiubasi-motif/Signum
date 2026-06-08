# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY src/db/package*.json ./src/db/

RUN npm ci

COPY . .

# Generate Prisma Client
WORKDIR /app/src/db
RUN npx prisma generate --schema=prisma/schema.prisma

# Build the application (compiling TypeScript to javascript in /dist)
WORKDIR /app
RUN npm run build || echo "Build skipped or completed"

# Stage 2: Production Runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY src/db/package*.json ./src/db/

RUN npm ci --omit=dev

# Copy built code and generated Prisma modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src/db/node_modules/.prisma ./src/db/node_modules/.prisma
COPY --from=builder /app/src/db/node_modules/@prisma ./src/db/node_modules/@prisma

# Copy prisma schema for database migration actions in container
COPY --from=builder /app/src/db/prisma ./src/db/prisma

# Optimize file permissions to run as unprivileged node user
RUN chown -R node:node /app

USER node

CMD ["node", "dist/index.js"]
