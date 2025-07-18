FROM node:22-slim AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/root/.cache/yarn \
    yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/root/.cache/yarn \
    yarn install --production --frozen-lockfile

FROM node:22-slim AS release
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=deps    /app/node_modules ./node_modules
COPY src/config     ./src/config
CMD ["node", "dist/main.js"]
