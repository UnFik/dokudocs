FROM oven/bun:1 AS dev

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 5173

# With the source bind-mounted, node_modules is a volume that outlives the image;
# install first so a dependency added to bun.lock after the build is there too.
CMD ["sh", "-c", "bun install --frozen-lockfile && exec bun run dev --host"]

FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

FROM nginx:alpine AS prod

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
