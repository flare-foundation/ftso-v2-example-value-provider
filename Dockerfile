FROM node:18-slim AS nodemodules

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-engines --network-timeout 100000

FROM node:18-slim AS build

WORKDIR /app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY . ./

RUN yarn build

FROM node:18-slim AS runtime

WORKDIR /app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY src/config src/config

CMD ["node", "dist/main.js"]
