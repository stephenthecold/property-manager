# Multi-stage build. One image serves the app (next start), the billing worker
# (tsx), and migrations/seed (prisma + tsx) — so dev tools must remain present.

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Copy the fully-built app including node_modules (native modules compiled on the
# same base image) and the generated Prisma client.
COPY --from=build /app ./
RUN chmod +x ./entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
CMD ["npm", "run", "start"]
