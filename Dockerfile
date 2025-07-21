FROM node:22-slim AS builder
WORKDIR /app
COPY package.json yarn.lock nest-cli.json tsconfig*.json ./
RUN --mount=type=cache,target=/root/.cache/yarn \
    yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:22-slim AS release
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder    /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]