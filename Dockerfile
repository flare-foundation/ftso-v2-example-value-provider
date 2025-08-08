FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/root/.cache/yarn \
    yarn install --frozen-lockfile
COPY . .
RUN yarn build
RUN yarn install --production --frozen-lockfile \
    && yarn cache clean

FROM node:22-alpine AS release
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]