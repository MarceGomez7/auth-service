FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY modules ./modules
COPY public ./public

USER node
EXPOSE 3000 3002 3003

CMD ["node", "modules/orders-service.js"]
