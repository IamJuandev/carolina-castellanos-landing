FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY Landing ./Landing
COPY server ./server
ENV PORT=3000
ENV DATABASE_PATH=/app/data/cronograma.db
ENV UPLOADS_DIR=/app/data/uploads
EXPOSE 3000
CMD ["node", "server/server.js"]
