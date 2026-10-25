# 1단계: 빌드 (Node.js)
FROM node:24-alpine AS build-stage
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2단계: 서빙 (Nginx)
# 프론트엔드 전용 Nginx를 써도 되지만, 
# 형민님은 루트에 별도 Nginx가 있으니 파일만 넘겨주는 식으로 구성합니다.
FROM nginx:stable-alpine AS production-stage
COPY default.conf /etc/nginx/conf.d/default.conf
COPY --from=build-stage /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
