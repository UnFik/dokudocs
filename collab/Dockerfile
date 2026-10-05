# Build from the repository root: docker build -f collab/Dockerfile .
# The editor's schema is shared with the frontend, so those two files come along.
FROM node:22-alpine
WORKDIR /app/collab
COPY collab/package.json collab/package-lock.json ./
RUN npm ci --omit=dev && npm i --no-save tsx
COPY collab/tsconfig.json ./
COPY collab/src ./src
COPY frontend/src/features/docs/lib/prosemirror/documentSchema.ts /app/frontend/src/features/docs/lib/prosemirror/documentSchema.ts
COPY frontend/src/features/docs/lib/author-color.ts /app/frontend/src/features/docs/lib/author-color.ts
ENV NODE_ENV=production
EXPOSE 1234
CMD ["npx", "tsx", "src/main.ts"]
