# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Baked into the bundle at build time; an empty API URL makes the app call /api on its own origin
ARG VITE_KEYCLOAK_URL
ARG VITE_KEYCLOAK_REALM=ugo
ARG VITE_KEYCLOAK_CLIENT_ID=ugo-frontend
ENV VITE_API_URL="" \
    VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
