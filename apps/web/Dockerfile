# syntax = docker/dockerfile:1.4

FROM node:22-alpine3.20@sha256:40be979442621049f40b1d51a26b55e281246b5de4e5f51a18da7beb6e17e3f9 AS base

# Enable BuildKit cache mounts

#
## step 1: Prune monorepo
#
# FROM base AS builder
# RUN apk add --no-cache libc6-compat
# RUN apk update
# Set working directory
# WORKDIR /app
# RUN yarn global add turbo
# COPY . .
# RUN turbo prune @formbricks/web --docker

#
## step 2: Install & build
#
FROM base AS installer

# Enable corepack and prepare pnpm
RUN npm install -g corepack@latest
RUN corepack enable

# Install necessary build tools and compilers
RUN apk update && apk add --no-cache cmake g++ gcc jq make openssl-dev python3

# BuildKit secret handling without hardcoded fallback values
RUN echo '#!/bin/sh' > /tmp/read-secrets.sh && \
    echo 'if [ -f "/run/secrets/database_url" ]; then' >> /tmp/read-secrets.sh && \
    echo '  export DATABASE_URL=$(cat /run/secrets/database_url)' >> /tmp/read-secrets.sh && \
    echo 'else' >> /tmp/read-secrets.sh && \
    echo '  echo "DATABASE_URL secret not found. Build may fail if this is required."' >> /tmp/read-secrets.sh && \
    echo 'fi' >> /tmp/read-secrets.sh && \
    echo 'if [ -f "/run/secrets/encryption_key" ]; then' >> /tmp/read-secrets.sh && \
    echo '  export ENCRYPTION_KEY=$(cat /run/secrets/encryption_key)' >> /tmp/read-secrets.sh && \
    echo 'else' >> /tmp/read-secrets.sh && \
    echo '  echo "ENCRYPTION_KEY secret not found. Build may fail if this is required."' >> /tmp/read-secrets.sh && \
    echo 'fi' >> /tmp/read-secrets.sh && \
    echo 'exec "$@"' >> /tmp/read-secrets.sh && \
    chmod +x /tmp/read-secrets.sh

# Increase Node.js memory limit
ARG NODE_OPTIONS="--max_old_space_size=4096"
ENV NODE_OPTIONS=${NODE_OPTIONS}

WORKDIR /app

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./
COPY packages/database/package.json ./packages/database/
COPY apps/web/package.json ./apps/web/

# Use cache mount for pnpm store
RUN --mount=type=cache,id=s/4584586d-a557-4c41-be07-39c9304b1215-pnpm-cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy the rest of the source code
COPY . .

# Create .env file
RUN touch apps/web/.env

# Use cache mount for Next.js build cache
RUN --mount=type=cache,id=s/4584586d-a557-4c41-be07-39c9304b1215-next-cache,target=/app/apps/web/.next/cache \
    --mount=type=secret,id=database_url \
    --mount=type=secret,id=encryption_key \
    /tmp/read-secrets.sh pnpm build --filter=@formbricks/web...

# Extract Prisma version
RUN jq -r '.devDependencies.prisma' packages/database/package.json > /prisma_version.txt

#
## step 3: setup production runner
#
FROM base AS runner

# Use cache mount for global npm packages
RUN --mount=type=cache,id=s/4584586d-a557-4c41-be07-39c9304b1215-npm-cache,target=/root/.npm \
    npm install -g corepack@latest tsx typescript prisma pino-pretty

RUN corepack enable

RUN apk add --no-cache curl supercronic && \
    adduser --system --uid 1001 nextjs

WORKDIR /home/nextjs

# Copy built application
COPY --from=installer --chown=nextjs:nextjs /app/apps/web/.next/standalone ./
COPY --from=installer --chown=nextjs:nextjs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=installer --chown=nextjs:nextjs /app/apps/web/public ./apps/web/public
COPY --from=installer /app/apps/web/next.config.mjs .
COPY --from=installer /app/apps/web/package.json .

# Copy database files
COPY --from=installer --chown=nextjs:nextjs /app/packages/database/schema.prisma ./packages/database/
COPY --from=installer --chown=nextjs:nextjs /app/packages/database/package.json ./packages/database/
COPY --from=installer --chown=nextjs:nextjs /app/packages/database/migration ./packages/database/migration
COPY --from=installer --chown=nextjs:nextjs /app/packages/database/src ./packages/database/src
COPY --from=installer --chown=nextjs:nextjs /app/packages/database/node_modules ./packages/database/node_modules

# Copy additional dependencies
COPY --from=installer --chown=nextjs:nextjs /app/packages/logger/dist ./packages/database/node_modules/@formbricks/logger/dist
COPY --from=installer --chown=nextjs:nextjs /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=installer --chown=nextjs:nextjs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=installer --chown=nextjs:nextjs /app/node_modules/@paralleldrive/cuid2 ./node_modules/@paralleldrive/cuid2
COPY --from=installer --chown=nextjs:nextjs /app/node_modules/@noble/hashes ./node_modules/@noble/hashes
COPY --from=installer --chown=nextjs:nextjs /app/node_modules/zod ./node_modules/zod
COPY --from=installer --chown=nextjs:nextjs /prisma_version.txt .

# Copy cron jobs
COPY /docker/cronjobs /app/docker/cronjobs

# Set permissions
RUN chmod -R 755 . && \
    chmod 644 ./next.config.mjs && \
    chmod 644 ./package.json && \
    chmod 644 ./packages/database/schema.prisma && \
    chmod 644 ./packages/database/package.json && \
    chmod 644 ./prisma_version.txt && \
    chmod -R 755 /app/docker/cronjobs

EXPOSE 3000
ENV HOSTNAME "0.0.0.0"
ENV NODE_ENV="production"

# Prepare directories in Railway's persistent /data path
RUN mkdir -p /data/uploads /data/saml-connection && \
    ln -s /data/uploads /home/nextjs/apps/web/uploads && \
    ln -s /data/saml-connection /home/nextjs/apps/web/saml-connection && \
    chown -R nextjs:nextjs /data

USER nextjs

CMD if [ "${DOCKER_CRON_ENABLED:-1}" = "1" ]; then \
      echo "Starting cron jobs..."; \
      supercronic -quiet /app/docker/cronjobs & \
    else \
      echo "Docker cron jobs are disabled via DOCKER_CRON_ENABLED=0"; \
    fi; \
    (cd packages/database && npm run db:migrate:deploy) && \
    (cd packages/database && npm run db:create-saml-database:deploy) && \
    exec node apps/web/server.js