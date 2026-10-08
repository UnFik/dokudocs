FROM golang:1.25-alpine AS dev

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

EXPOSE 8080

CMD ["go", "run", "./cmd/server"]

FROM dev AS builder

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/seeder ./cmd/seeder

FROM alpine:3.22 AS prod

RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /out/ /usr/local/bin/
COPY --from=builder /app/database/migrations ./database/migrations
COPY --from=builder /app/docs/swagger.* ./docs/
EXPOSE 8080
CMD ["server"]
