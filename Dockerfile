FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production \
    DATABASE_PATH=/data/app.db \
    PORT=3000
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
