# Build from the repository root: docker build -f collab/Dockerfile .
# The editor's schema is shared with the frontend, so those files come along.
FROM node:22-alpine
WORKDIR /app/collab
COPY collab/package.json collab/package-lock.json ./
RUN npm ci --omit=dev && npm i --no-save tsx
COPY collab/tsconfig.json ./
COPY collab/src ./src
COPY collab/tsconfig.run.json ./
COPY frontend/src/features/docs/lib/prosemirror/documentSchema.ts /app/frontend/src/features/docs/lib/prosemirror/documentSchema.ts
COPY frontend/src/features/docs/lib/author-color.ts /app/frontend/src/features/docs/lib/author-color.ts
COPY frontend/src/features/architecture/lib/canvas-model.ts /app/frontend/src/features/architecture/lib/canvas-model.ts
# Without a package.json there, Node reads those files as CommonJS and loads a second copy of prosemirror-model.
RUN echo '{"type":"module"}' > /app/frontend/package.json
ENV NODE_ENV=production
EXPOSE 1234
CMD ["npx", "tsx", "--tsconfig", "tsconfig.run.json", "src/main.ts"]
