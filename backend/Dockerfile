FROM node:22-alpine AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json server.js db.js ./
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN apk add --no-cache su-exec && addgroup -S app && adduser -S app -G app && mkdir -p uploads && chown -R app:app /app && chmod +x /usr/local/bin/docker-entrypoint
EXPOSE 5000
ENTRYPOINT ["docker-entrypoint"]
CMD ["npm", "start"]
