# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /workspace

COPY frontend/package*.json frontend/
RUN --mount=type=cache,target=/root/.npm cd frontend && npm ci

COPY frontend frontend
COPY submission submission
COPY 关于.md 关于.md

ARG VITE_APP_BASE_PATH=/labelhub/
ARG VITE_API_BASE_URL=/labelhub/api
ARG VITE_TURNSTILE_SITE_KEY
ARG VITE_DEMO_VIDEO_URL
ARG VITE_APP_VERSION

ENV VITE_APP_BASE_PATH=${VITE_APP_BASE_PATH} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY} \
    VITE_DEMO_VIDEO_URL=${VITE_DEMO_VIDEO_URL} \
    VITE_APP_VERSION=${VITE_APP_VERSION}

RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html

EXPOSE 80
