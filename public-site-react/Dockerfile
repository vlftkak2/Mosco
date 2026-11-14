# 스틸119 홈페이지 — 빌드한 정적 파일을 nginx 로 서빙한다 (frontend/Dockerfile 과 같은 방식)
FROM node:24-alpine AS build-stage
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:stable-alpine AS production-stage
COPY default.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
