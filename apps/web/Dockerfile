FROM oven/bun:alpine AS base

FROM base AS pruner

WORKDIR /app

COPY apps/web/package.json apps/web/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY package.json package.json

WORKDIR /app/apps/web

FROM base AS builder

WORKDIR /app

ARG FREESOUND_CLIENT_ID
ARG FREESOUND_API_KEY
ARG NEXT_PUBLIC_SARVAM_API_KEY
ARG NEXT_PUBLIC_SMALLEST_API_KEY
ARG NEXT_PUBLIC_SEEDANCE_API_KEY
ARG NEXT_PUBLIC_REPLICATE_API_TOKEN
ARG NEXT_PUBLIC_STABILITY_API_KEY
ARG NEXT_PUBLIC_LUMA_API_KEY
ARG NEXT_PUBLIC_OPENAI_API_KEY
ARG NEXT_PUBLIC_OPENAI_BASE_URL
ARG NEXT_PUBLIC_OPENAI_MODEL
ARG NEXT_PUBLIC_OPENAI_IMAGE_MODEL
ARG NEXT_PUBLIC_OPENAI_VISION_CAPABLE

COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json

COPY apps/web/package.json apps/web/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --ignore-scripts && \
    cd /app && \
    sed -i '/@napi-rs\/canvas/d' apps/web/package.json && \
    bun install

COPY apps/web/ apps/web/
COPY packages/env/ packages/env/
COPY packages/ui/ packages/ui/

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ENV DATABASE_URL="postgresql://opencut:opencut@localhost:5432/opencut"
ENV BETTER_AUTH_SECRET="build-time-secret"
ENV UPSTASH_REDIS_REST_URL="http://localhost:8079"
ENV UPSTASH_REDIS_REST_TOKEN="example_token"
ENV NEXT_PUBLIC_SITE_URL="http://localhost:3000"
ENV NEXT_PUBLIC_MARBLE_API_URL="https://api.marblecms.com"
ENV NEXT_PUBLIC_AI_BACKEND_URL="http://localhost:8420"

ENV FREESOUND_CLIENT_ID=$FREESOUND_CLIENT_ID
ENV FREESOUND_API_KEY=$FREESOUND_API_KEY
ENV NEXT_PUBLIC_SARVAM_API_KEY=$NEXT_PUBLIC_SARVAM_API_KEY
ENV NEXT_PUBLIC_SMALLEST_API_KEY=$NEXT_PUBLIC_SMALLEST_API_KEY
ENV NEXT_PUBLIC_SEEDANCE_API_KEY=$NEXT_PUBLIC_SEEDANCE_API_KEY
ENV NEXT_PUBLIC_REPLICATE_API_TOKEN=$NEXT_PUBLIC_REPLICATE_API_TOKEN
ENV NEXT_PUBLIC_STABILITY_API_KEY=$NEXT_PUBLIC_STABILITY_API_KEY
ENV NEXT_PUBLIC_LUMA_API_KEY=$NEXT_PUBLIC_LUMA_API_KEY
ENV NEXT_PUBLIC_OPENAI_API_KEY=$NEXT_PUBLIC_OPENAI_API_KEY
ENV NEXT_PUBLIC_OPENAI_BASE_URL=$NEXT_PUBLIC_OPENAI_BASE_URL
ENV NEXT_PUBLIC_OPENAI_MODEL=$NEXT_PUBLIC_OPENAI_MODEL
ENV NEXT_PUBLIC_OPENAI_IMAGE_MODEL=$NEXT_PUBLIC_OPENAI_IMAGE_MODEL
ENV NEXT_PUBLIC_OPENAI_VISION_CAPABLE=$NEXT_PUBLIC_OPENAI_VISION_CAPABLE

WORKDIR /app/apps/web
RUN --mount=type=cache,target=/app/apps/web/.next/cache \
    bun run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
