FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.functions.json ./
COPY public ./public
COPY src ./src
ARG VITE_BACKEND_ENABLED=true
ARG VITE_X402_ENABLED=true
ARG VITE_X402_GATEWAY_BASE=/x402
ARG VITE_PREPAID_TOPUP_USDC=0.5
ENV VITE_BACKEND_ENABLED=${VITE_BACKEND_ENABLED}
ENV VITE_X402_ENABLED=${VITE_X402_ENABLED}
ENV VITE_X402_GATEWAY_BASE=${VITE_X402_GATEWAY_BASE}
ENV VITE_PREPAID_TOPUP_USDC=${VITE_PREPAID_TOPUP_USDC}
RUN npm run build:web

FROM nginx:1.29-alpine
COPY deploy/cloud-run/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=8080
EXPOSE 8080
