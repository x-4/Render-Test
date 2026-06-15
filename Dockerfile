FROM node:18-alpine
WORKDIR /app
# 先复制 package.json 并安装依赖，利用 Docker 缓存加速启动
COPY package.json ./
RUN npm install
# 再复制源代码
COPY server.js ./
ENV PORT=7860
EXPOSE 7860
CMD ["node", "server.js"]