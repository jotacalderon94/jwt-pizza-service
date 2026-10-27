ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY src/config.production.js ./src/config.js

EXPOSE 80

CMD ["node", "src/index.js", "80"]