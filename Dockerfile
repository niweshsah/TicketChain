FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/blockchain/package.json packages/blockchain/package.json
RUN npm ci
COPY . .
ARG VITE_PUBLIC_DEMO=false
ENV VITE_PUBLIC_DEMO=$VITE_PUBLIC_DEMO
RUN npm run db:generate -w @ticketchain/api && npm run build
FROM build AS api
USER node
EXPOSE 5000
CMD ["npm", "run", "start", "-w", "@ticketchain/api"]
FROM api AS identity
CMD ["node", "apps/api/dist/src/services/identity/server.js"]
FROM api AS booking
CMD ["node", "apps/api/dist/src/services/booking/server.js"]
FROM api AS payments
CMD ["node", "apps/api/dist/src/services/payments/server.js"]
FROM api AS catalog
CMD ["node", "apps/api/dist/src/services/catalog/server.js"]
FROM nginx:1.28-alpine AS web
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/gateway/local-headers.conf /etc/nginx/proxy-headers.conf
EXPOSE 80
FROM web AS demo-web
COPY infrastructure/gateway/demo-headers.conf /etc/nginx/proxy-headers.conf
FROM build AS validation
USER node
CMD ["sh", "-c", "DATABASE_URL=$TEST_DATABASE_URL npm run db:migrate && npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration"]
