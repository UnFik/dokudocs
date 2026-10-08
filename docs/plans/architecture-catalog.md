# Architecture catalog

Status: the full list for the first seed of `catalog_entries`. It belongs to [the Architecture document plan](architecture-document.md); terms follow `GLOSSARY.md`.

The catalog is global and read-only to people. A migration seeds it; adding, renaming or retiring an entry is a new migration.

## Rules for entries

- **Slug**: lowercase kebab-case, stable forever. Canvases store the slug, so a slug is never renamed or reused. A retired entry gets `deprecated = true`: it leaves the palette, and existing canvases still show it with its name.
- **Name**: the name people know, as the vendor writes it ("PostgreSQL", "Next.js").
- **Subkind**: where the entry sits in the palette and which protocols are suggested for it. It never limits what may be drawn.
- **Managed services are Hosts, engines are Systems.** "AWS RDS" is a Host; the "PostgreSQL" running in it is a System. A third-party API you call but do not run (Stripe, OpenAI) is an `external` System with no Host.
- **One entry per thing.** A version (PostgreSQL 16) is not an entry. A runtime, library or build tool that is not a running part (Vite, GORM, Prisma) is not an entry either: put it in the System's description.
- Every entry has an icon or an explicit fallback; see [Icons](#icons).

## Schema

```
catalog_entries
  slug        text pk
  category    enum      -- host | system | protocol
  subkind     text      -- see the lists below; required for every entry
  name        text
  family      text null -- protocol only: request | stream | message | data | telemetry
  sort_order  int       -- order inside its subkind in the palette
  deprecated  bool      default false
```

## Hosts

### Subkind `compute`: machines you run yourself

| slug | name |
|---|---|
| `bare-metal` | Bare metal server |
| `vps` | VPS |
| `vm` | Virtual machine |
| `docker-host` | Docker host |
| `container` | Container |
| `on-premise` | On-premise datacenter |
| `laptop` | Developer laptop |

### Subkind `orchestration`

| slug | name |
|---|---|
| `kubernetes` | Kubernetes cluster |
| `kubernetes-namespace` | Kubernetes namespace |
| `kubernetes-node` | Kubernetes node |
| `kubernetes-pod` | Kubernetes pod |
| `docker-swarm` | Docker Swarm |
| `nomad` | Nomad cluster |

### Subkind `network`

| slug | name |
|---|---|
| `vpc` | VPC |
| `subnet` | Subnet |
| `dmz` | DMZ |
| `region` | Region |
| `availability-zone` | Availability zone |

### Subkind `aws`

| slug | name |
|---|---|
| `aws-ec2` | AWS EC2 |
| `aws-ecs` | AWS ECS |
| `aws-fargate` | AWS Fargate |
| `aws-eks` | AWS EKS |
| `aws-lambda` | AWS Lambda |
| `aws-lightsail` | AWS Lightsail |
| `aws-elastic-beanstalk` | AWS Elastic Beanstalk |
| `aws-rds` | AWS RDS |
| `aws-aurora` | AWS Aurora |
| `aws-elasticache` | AWS ElastiCache |
| `aws-msk` | AWS MSK |
| `aws-opensearch` | AWS OpenSearch Service |
| `aws-amplify` | AWS Amplify |

### Subkind `gcp`

| slug | name |
|---|---|
| `gcp-compute-engine` | Google Compute Engine |
| `gcp-cloud-run` | Google Cloud Run |
| `gcp-gke` | Google Kubernetes Engine |
| `gcp-cloud-functions` | Google Cloud Functions |
| `gcp-app-engine` | Google App Engine |
| `gcp-cloud-sql` | Google Cloud SQL |
| `gcp-memorystore` | Google Memorystore |
| `firebase-hosting` | Firebase Hosting |

### Subkind `azure`

| slug | name |
|---|---|
| `azure-vm` | Azure Virtual Machines |
| `azure-aks` | Azure Kubernetes Service |
| `azure-app-service` | Azure App Service |
| `azure-container-apps` | Azure Container Apps |
| `azure-functions` | Azure Functions |
| `azure-sql` | Azure SQL Database |
| `azure-database-postgresql` | Azure Database for PostgreSQL |
| `azure-cache-redis` | Azure Cache for Redis |

### Subkind `paas`: other managed platforms

| slug | name |
|---|---|
| `vercel` | Vercel |
| `netlify` | Netlify |
| `cloudflare-workers` | Cloudflare Workers |
| `cloudflare-pages` | Cloudflare Pages |
| `heroku` | Heroku |
| `fly-io` | Fly.io |
| `render` | Render |
| `railway` | Railway |
| `digitalocean-droplet` | DigitalOcean Droplet |
| `digitalocean-app-platform` | DigitalOcean App Platform |
| `digitalocean-managed-db` | DigitalOcean Managed Database |
| `supabase` | Supabase |
| `neon` | Neon |
| `planetscale` | PlanetScale |
| `upstash` | Upstash |
| `mongodb-atlas` | MongoDB Atlas |
| `confluent-cloud` | Confluent Cloud |
| `alibaba-cloud-ecs` | Alibaba Cloud ECS |
| `biznet-gio` | Biznet Gio |
| `idcloudhost` | IDCloudHost |

### Subkind `client`: where a frontend runs for its user

| slug | name |
|---|---|
| `browser` | Web browser |
| `ios` | iOS device |
| `android` | Android device |
| `desktop` | Desktop computer |
| `iot-device` | IoT device |

A React app built on Vercel and used in a browser can sit in either Host; pick the one the diagram is about (deployment or runtime).

## Systems

### Subkind `language`: a service named by its language or runtime

| slug | name |
|---|---|
| `golang` | Go |
| `nodejs` | Node.js |
| `deno` | Deno |
| `bun` | Bun |
| `typescript` | TypeScript |
| `javascript` | JavaScript |
| `python` | Python |
| `java` | Java |
| `kotlin` | Kotlin |
| `csharp` | C# / .NET |
| `php` | PHP |
| `ruby` | Ruby |
| `rust` | Rust |
| `elixir` | Elixir |
| `scala` | Scala |
| `cpp` | C++ |
| `c` | C |
| `swift` | Swift |
| `dart` | Dart |
| `lua` | Lua |

### Subkind `frontend`

| slug | name |
|---|---|
| `react` | React |
| `nextjs` | Next.js |
| `remix` | Remix |
| `tanstack-start` | TanStack Start |
| `vue` | Vue |
| `nuxt` | Nuxt |
| `angular` | Angular |
| `svelte` | Svelte |
| `sveltekit` | SvelteKit |
| `solid` | SolidJS |
| `astro` | Astro |
| `qwik` | Qwik |
| `preact` | Preact |
| `htmx` | htmx |
| `static-site` | Static site |

### Subkind `backend`

| slug | name |
|---|---|
| `gin` | Gin |
| `echo` | Echo |
| `fiber` | Fiber |
| `chi` | chi |
| `go-net-http` | Go net/http |
| `express` | Express |
| `nestjs` | NestJS |
| `fastify` | Fastify |
| `hono` | Hono |
| `koa` | Koa |
| `adonisjs` | AdonisJS |
| `django` | Django |
| `fastapi` | FastAPI |
| `flask` | Flask |
| `spring-boot` | Spring Boot |
| `quarkus` | Quarkus |
| `micronaut` | Micronaut |
| `ktor` | Ktor |
| `aspnet-core` | ASP.NET Core |
| `laravel` | Laravel |
| `symfony` | Symfony |
| `rails` | Ruby on Rails |
| `phoenix` | Phoenix |
| `actix-web` | Actix Web |
| `axum` | Axum |

### Subkind `mobile`

| slug | name |
|---|---|
| `react-native` | React Native |
| `expo` | Expo |
| `flutter` | Flutter |
| `swiftui` | SwiftUI |
| `jetpack-compose` | Jetpack Compose |
| `kotlin-multiplatform` | Kotlin Multiplatform |
| `ionic` | Ionic |
| `electron` | Electron |
| `tauri` | Tauri |

### Subkind `database`

| slug | name |
|---|---|
| `postgresql` | PostgreSQL |
| `mysql` | MySQL |
| `mariadb` | MariaDB |
| `sqlite` | SQLite |
| `sql-server` | Microsoft SQL Server |
| `oracle` | Oracle Database |
| `cockroachdb` | CockroachDB |
| `tidb` | TiDB |
| `mongodb` | MongoDB |
| `couchdb` | CouchDB |
| `cassandra` | Apache Cassandra |
| `scylladb` | ScyllaDB |
| `dynamodb` | Amazon DynamoDB |
| `firestore` | Cloud Firestore |
| `neo4j` | Neo4j |
| `clickhouse` | ClickHouse |
| `timescaledb` | TimescaleDB |
| `influxdb` | InfluxDB |
| `duckdb` | DuckDB |
| `qdrant` | Qdrant |
| `weaviate` | Weaviate |
| `milvus` | Milvus |
| `chroma` | Chroma |
| `gcp-spanner` | Google Cloud Spanner |
| `gcp-bigquery` | Google BigQuery |
| `gcp-bigtable` | Google Cloud Bigtable |

### Subkind `cache`

| slug | name |
|---|---|
| `redis` | Redis |
| `valkey` | Valkey |
| `memcached` | Memcached |
| `dragonfly` | Dragonfly |
| `keydb` | KeyDB |

### Subkind `search`

| slug | name |
|---|---|
| `elasticsearch` | Elasticsearch |
| `opensearch` | OpenSearch |
| `meilisearch` | Meilisearch |
| `typesense` | Typesense |
| `solr` | Apache Solr |

### Subkind `broker`

| slug | name |
|---|---|
| `kafka` | Apache Kafka |
| `redpanda` | Redpanda |
| `rabbitmq` | RabbitMQ |
| `nats` | NATS |
| `redis-streams` | Redis Streams |
| `pulsar` | Apache Pulsar |
| `activemq` | ActiveMQ |
| `mosquitto` | Eclipse Mosquitto (MQTT) |
| `emqx` | EMQX (MQTT) |
| `aws-sqs` | Amazon SQS |
| `aws-sns` | Amazon SNS |
| `aws-eventbridge` | Amazon EventBridge |
| `gcp-pubsub` | Google Pub/Sub |
| `azure-service-bus` | Azure Service Bus |
| `gcp-cloud-tasks` | Google Cloud Tasks |

### Subkind `gateway`: web servers, proxies, load balancers, API gateways

| slug | name |
|---|---|
| `nginx` | Nginx |
| `caddy` | Caddy |
| `traefik` | Traefik |
| `haproxy` | HAProxy |
| `apache-httpd` | Apache HTTP Server |
| `envoy` | Envoy |
| `kong` | Kong |
| `apisix` | Apache APISIX |
| `istio` | Istio |
| `aws-alb` | AWS Application Load Balancer |
| `aws-api-gateway` | Amazon API Gateway |
| `cloudflare` | Cloudflare |
| `cloudfront` | Amazon CloudFront |
| `gcp-load-balancing` | Google Cloud Load Balancing |
| `gcp-cloud-cdn` | Google Cloud CDN |
| `gcp-api-gateway` | Google Cloud API Gateway |

### Subkind `storage`

| slug | name |
|---|---|
| `aws-s3` | Amazon S3 |
| `gcs` | Google Cloud Storage |
| `azure-blob` | Azure Blob Storage |
| `cloudflare-r2` | Cloudflare R2 |
| `minio` | MinIO |
| `ceph` | Ceph |
| `nfs` | NFS share |
| `local-disk` | Local disk |

### Subkind `auth`

| slug | name |
|---|---|
| `keycloak` | Keycloak |
| `auth0` | Auth0 |
| `clerk` | Clerk |
| `firebase-auth` | Firebase Authentication |
| `supabase-auth` | Supabase Auth |
| `aws-cognito` | Amazon Cognito |
| `ory` | Ory |
| `zitadel` | ZITADEL |
| `authentik` | authentik |
| `openldap` | OpenLDAP |
| `active-directory` | Active Directory |
| `gcp-identity-platform` | Google Identity Platform |

### Subkind `observability`

| slug | name |
|---|---|
| `prometheus` | Prometheus |
| `grafana` | Grafana |
| `loki` | Grafana Loki |
| `tempo` | Grafana Tempo |
| `jaeger` | Jaeger |
| `opentelemetry-collector` | OpenTelemetry Collector |
| `elastic-apm` | Elastic APM |
| `logstash` | Logstash |
| `kibana` | Kibana |
| `fluent-bit` | Fluent Bit |
| `sentry` | Sentry |
| `datadog` | Datadog |
| `new-relic` | New Relic |

### Subkind `ai`: models you run yourself

| slug | name |
|---|---|
| `ollama` | Ollama |
| `vllm` | vLLM |
| `llama-cpp` | llama.cpp |
| `text-embeddings-inference` | Text Embeddings Inference |

### Subkind `job`: a part named by its role, not its technology

| slug | name |
|---|---|
| `service` | Service |
| `worker` | Background worker |
| `scheduled-job` | Scheduled job |
| `cli` | Command-line tool |
| `batch-job` | Batch job |
| `gcp-cloud-scheduler` | Google Cloud Scheduler |

### Subkind `external`: third-party APIs you call but do not run

| slug | name |
|---|---|
| `stripe` | Stripe |
| `midtrans` | Midtrans |
| `xendit` | Xendit |
| `paypal` | PayPal |
| `sendgrid` | SendGrid |
| `mailgun` | Mailgun |
| `resend` | Resend |
| `aws-ses` | Amazon SES |
| `twilio` | Twilio |
| `whatsapp-business` | WhatsApp Business Platform |
| `firebase-cloud-messaging` | Firebase Cloud Messaging |
| `onesignal` | OneSignal |
| `google-maps` | Google Maps Platform |
| `google-oauth` | Google Sign-In |
| `github` | GitHub |
| `gitlab` | GitLab |
| `slack` | Slack |
| `algolia` | Algolia |
| `pinecone` | Pinecone |
| `openai` | OpenAI API |
| `anthropic` | Anthropic API |
| `google-gemini` | Google Gemini API |
| `saas` | Other SaaS |

## Connections (protocols)

`family` sets the line style on the canvas and the legend.

| family | line |
|---|---|
| `request` | solid, one arrow |
| `stream` | solid, heavier |
| `message` | dashed |
| `data` | dotted |
| `telemetry` | thin dashed, muted |

### Family `request`

| slug | name |
|---|---|
| `rest` | REST |
| `http` | HTTP |
| `graphql` | GraphQL |
| `grpc` | gRPC |
| `trpc` | tRPC |
| `json-rpc` | JSON-RPC |
| `soap` | SOAP |
| `webhook` | Webhook |
| `oidc` | OpenID Connect / OAuth 2.0 |
| `ldap` | LDAP |
| `smtp` | SMTP |

### Family `stream`

| slug | name |
|---|---|
| `websocket` | WebSocket |
| `sse` | Server-Sent Events |
| `grpc-stream` | gRPC streaming |
| `webrtc` | WebRTC |
| `tcp` | TCP |
| `udp` | UDP |

### Family `message`

| slug | name |
|---|---|
| `publish` | Publish |
| `subscribe` | Subscribe |

Both point at the broker (caller → callee). The broker's kind (Kafka topic, RabbitMQ queue, MQTT topic) comes from the broker System, so there is no protocol per broker.

### Family `data`

| slug | name |
|---|---|
| `db-connection` | Database connection |
| `cache-connection` | Cache connection |
| `object-storage` | Object storage (S3 API) |
| `file-share` | File share (NFS, SMB) |
| `sftp` | SFTP |
| `replication` | Replication |
| `cdc` | Change data capture |
| `batch-import` | Batch import |

### Family `telemetry`

| slug | name |
|---|---|
| `metrics-scrape` | Metrics scrape |
| `otlp` | OTLP export |
| `log-shipping` | Log shipping |

## Suggested protocols by target

The protocol popover lists these first, by the subkind of the System the line points at. Everything else follows under "Other". Nothing is refused.

| Target subkind | Suggested, in order |
|---|---|
| `backend`, `language`, `job` | `rest`, `grpc`, `graphql`, `websocket` |
| `frontend`, `mobile` | `rest`, `websocket`, `sse` |
| `gateway` | `http`, `rest`, `grpc` |
| `database` | `db-connection`, `replication`, `cdc` |
| `cache` | `cache-connection` |
| `search` | `rest`, `batch-import` |
| `broker` | `publish`, `subscribe` |
| `storage` | `object-storage`, `file-share`, `sftp` |
| `auth` | `oidc`, `ldap` |
| `observability` | `otlp`, `log-shipping`, `metrics-scrape` |
| `ai` | `rest`, `grpc` |
| `external` | `rest`, `webhook`, `smtp` |

## Requesting an entry

The catalog is global and read-only, so a search in the palette can come up empty. Then the palette says so and offers two things:

- **Use it now.** A palette item "Drag “<typed name>” as a Service" places a System with catalog entry `service` (subkind `job`) and the typed name. Nobody waits for the catalog to draw their diagram.
- **Ask for it.** "Request “<typed name>”" opens a short form: name (prefilled), kind (System, Host or protocol), official website (optional), what it is used for (optional). Sending it shows "Request sent; you will be notified when it is added."

```
catalog_requests
  id            uuid pk
  name          text             -- as typed
  name_key      text             -- lowercased, punctuation removed; same key = same request
  category      enum             -- host | system | protocol
  website       text null
  note          text null
  status        enum             -- open | added | declined
  resolved_slug text null fk catalog_entries
  created_at    timestamptz

catalog_request_votes
  request_id    uuid fk catalog_requests
  user_id       uuid fk users
  workspace_id  uuid fk workspaces
  created_at    timestamptz
  pk (request_id, user_id)
```

- A request with a `name_key` that already exists adds a vote instead of a new row, so the list shows demand ("Midtrans · 7 requests").
- Platform admins (users with the `superadmin` or `admin` role) see the list sorted by votes, from "Review requests" in the palette. Adding an entry is still a migration; when it ships, the request is marked `added` with its slug, or `declined` with a reason, and every voter gets an in-app notification (`notifications` table, `GET /api/v1/notifications`), shown under "Your requests" in the palette.
- Declining records a short reason that voters see in the notification.
- After the entry exists, a person changes a generic node's entry from the properties panel (catalog picker); name, links and position stay.
- `POST /api/v1/catalog/requests` needs only a signed-in user; a user may have at most 20 open requests, so the form cannot be used to flood the list.

## Icons

Decided 2026-10-07: full brand colour, official cloud service icons, no uploads. The palette exception is written in `DESIGN.md` (Icons).

### Where they live

Icons are SVG files in the frontend (`frontend/src/assets/catalog/<slug>.svg`), loaded per slug with `import()` so they stay out of the main bundle. They are never hotlinked from another site:

- An Architecture document opens offline (LocalCopy); a remote icon would be broken there.
- PNG and SVG export draws the canvas into an image; an image from another origin without CORS cannot be drawn.
- Every viewer would call a third party, and the CSP would have to allow it.
- A remote logo can change or disappear without notice.

### Sources, in order

| Order | Source | Licence | Used for |
|---|---|---|---|
| 1 | Official cloud architecture icons (AWS Architecture Icons, Google Cloud icons, Azure architecture icons) | Provider terms that allow use in architecture diagrams; check each set's current terms when importing | Every `aws-*`, `gcp-*`, `azure-*` Host and the managed services among Systems (`aws-s3`, `aws-sqs`, `dynamodb`, `gcp-pubsub`, …) |
| 2 | Devicon, "original" (coloured) variants | MIT | Languages, frameworks, databases, tools with a multi-colour logo |
| 3 | Simple Icons, path filled with its listed brand colour | CC0 (the logos stay their owners' trademarks) | Most remaining brands: brokers, gateways, SaaS, observability |
| 4 | The vendor's press kit or brand page | Vendor brand guidelines | Brands in none of the above (likely local ones such as Midtrans, Xendit, Biznet Gio, IDCloudHost) |
| 5 | Lucide, one icon per subkind | ISC | Entries that name a role, not a product (`service`, `worker`, `scheduled-job`, `vpc`, `subnet`, `browser`, `saas`, …) and the fallback for any slug without a file |

Logos are trademarks: they are shown only to name the product they belong to, unaltered apart from size and the theme variants below.

### Coverage (measured 2026-10-07)

Of the 265 Host and System entries of the first seed (nine Google Cloud services joined later, for 274), matched by name against Devicon (`devicon.json`, master) and Simple Icons 16.34.0:

| Where the icon comes from | Entries | Work |
|---|---|---|
| Devicon, coloured `original` variant | 98 | script only |
| Simple Icons with brand colour | 45 | script only |
| A product family's logo (Kubernetes for namespace/node/pod, Docker, DigitalOcean, MongoDB for Atlas, Firebase, Supabase, Grafana for Loki/Tempo, Vue, Svelte, Traefik, OpenTelemetry, Apache, WhatsApp, …) | about 30 | one mapping line each, reviewed by hand |
| Official AWS / Google Cloud / Azure icon sets | about 40 | script, after unpacking the provider's zip |
| Lucide by subkind (compute, network, client, job roles, `saas`, `local-disk`, `nfs`) | about 20 | mapping only |
| Vendor press kit, by hand | about 30 | download, check brand guidelines, add to `manual/` |

The hand-sourced group is mostly brands that are in neither set (Midtrans, Biznet Gio, IDCloudHost, Echo, chi, Axum, Micronaut, CockroachDB, Weaviate, Chroma, Valkey, Dragonfly, KeyDB, Typesense, Redpanda, ActiveMQ, EMQX, HAProxy, APISIX, ZITADEL, OpenLDAP, llama.cpp, Pinecone, OneSignal) and a few that Simple Icons no longer carries, such as OpenAI and SendGrid. Simple Icons drops a logo when its owner objects, so for those the owner's brand guidelines decide whether and how the logo may be used. The counts come from automatic name matching and will move slightly when someone reviews them by hand.

Mapped in the mock (2026-10-07), taking each entry's first available source in the order above: 43 official cloud icons, 118 Devicon logos, 50 Simple Icons logos, 54 still without one (press kit or Lucide). The pixel test put 21 logos on a white tile in dark mode (Next.js, GitHub, Vercel, Kafka, Rust, Express, Sentry, …) and 4 on a dark tile in light mode (JavaScript, Bun, ClickHouse, Railway).

### Generic entries use a generic icon

An entry that names a kind of thing rather than a product always gets a Lucide icon (stroke 1.5, `--ink`), even when some brand's logo would match its name. Decided 2026-10-07.

| Entry | Lucide icon |
|---|---|
| `bare-metal` | `server` |
| `vps` | `server-cog` |
| `vm` | `box` |
| `container` | `container` |
| `on-premise` | `building-2` |
| `laptop` | `laptop` |
| `vpc` | `network` |
| `subnet` | `layout-grid` |
| `dmz` | `shield-half` |
| `region` | `globe` |
| `availability-zone` | `map-pin` |
| `browser` | `app-window` |
| `desktop` | `monitor` |
| `iot-device` | `cpu` |
| `service` | `cog` |
| `worker` | `repeat` |
| `scheduled-job` | `clock` |
| `cli` | `terminal` |
| `batch-job` | `layers` |
| `nfs` | `folder-sync` |
| `local-disk` | `hard-drive` |
| `static-site` | `file-code` |
| `saas` | `cloud` |
| Group (palette) | `square-dashed` |

A branded entry whose logo is not in yet shows its subkind's Lucide icon in `--muted`, with the tooltip saying the logo is missing, until the press-kit logo is added:

| Subkind | Lucide icon | Subkind | Lucide icon |
|---|---|---|---|
| `compute` | `server` | `database` | `database` |
| `orchestration` | `layers` | `cache` | `zap` |
| `network` | `network` | `search` | `search` |
| `aws`, `gcp`, `azure`, `paas` | `cloud` | `broker` | `mail` |
| `client` | `monitor` | `gateway` | `route` |
| `language` | `code-xml` | `storage` | `hard-drive` |
| `frontend` | `app-window` | `auth` | `lock` |
| `backend` | `server` | `observability` | `activity` |
| `mobile` | `smartphone` | `ai` | `brain-circuit` |
| `job` | `cog` | `external` | `plug` |

In the mock that is 23 generic entries and 31 waiting for a logo (Midtrans, Biznet Gio, IDCloudHost, Echo, chi, Axum, Micronaut, CockroachDB, Weaviate, Chroma, Valkey, Dragonfly, KeyDB, Typesense, Redpanda, ActiveMQ, EMQX, HAProxy, APISIX, Cloudflare R2, ZITADEL, OpenLDAP, Active Directory, Elastic APM, llama.cpp, Text Embeddings Inference, SendGrid, OneSignal, Pinecone, OpenAI, Confluent Cloud).

### Terms of the cloud icon sets (read 2026-10-07)

- **AWS** (Architecture Icons, package of 31 July 2026): "We allow customers and partners to use these toolkits and assets to create architecture diagrams." No further licence text on the page.
- **Azure** (Azure Public Service Icons V24): use is permitted "in architectural diagrams, training materials, or documentation"; do not crop, flip, rotate, distort or change the shape; do not use them to represent your own product. Placing an icon on a tile changes none of that; recolouring would, so rule 2 below (recolour) never applies to cloud icons.
- **Google Cloud** (icon zip from cloud.google.com/icons): terms checked by the owner on 2026-10-07; use in Dokudocs is allowed.

All three were written for people drawing diagrams. Dokudocs ships the icons inside a diagram editor so that its users draw architecture diagrams, which is the stated purpose, but bundling them in a product is not explicitly covered. Google Cloud is cleared (above). For AWS and Azure, get a yes from whoever owns legal questions before release; until then those two stay in the plan and the mock only.

### Sourcing process

1. **Copy the SVGs into the repository, never fetch them during a build.** Builds stay reproducible and offline, and an icon that disappears upstream stays here.
2. **Pin the source versions** (Simple Icons major, Devicon commit, cloud icon set release) in `catalog-icons.json`. An upgrade is a deliberate change reviewed with the icon diff, because a Simple Icons major release removes icons.
3. **Order of work:** the scripted sources first (about 230 entries), then the hand-sourced ones. An entry without its logo yet ships with its Lucide fallback written in the mapping, so missing logos never block the catalog.
4. **Each hand-sourced logo records** the page it came from, the date, and the guideline that allows the use, in `ICON-SOURCES.md`.

### Light and dark themes

A logo keeps its brand colours in both themes, but some disappear in one of them: black logos (Next.js, GitHub, Vercel, Ollama) on the dark `--surface` (`#171A1F`), white or very pale ones (Bun's cream, white wordmarks) on the light `--surface` (`#FFFFFF`). Each such icon gets a second file for the theme where it fails; icons that read in both themes keep one file.

**Detecting it (build, no hand picking).** The script renders each icon at 64 px (resvg) on both surfaces and counts the opaque pixels whose contrast with that surface is below 1.5:1. If more than half of the logo is that faint on a surface, the icon needs a variant for that theme. (50% was set after running the test on the catalog: 40% also flagged Python and Neo4j, whose logos read well on both surfaces.) Measuring rendered pixels instead of the SVG's fill values handles multi-colour logos, gradients and nested groups the same way.

**Choosing the variant, in order:**

1. The brand's own variant for that background, when the source has one: the provider's dark-background version of a cloud icon, Devicon's `plain` or `light` variant, the light or dark logo from a press kit.
2. For a one-colour logo (Simple Icons): the same path filled with `--ink`'s value for that theme (`#E6E8EB` on dark, `#14171A` on light). The shape stays the brand's; only the colour that was invisible changes.
3. Otherwise the original logo on a small contrasting tile: `#FFFFFF` in dark mode, `#14171A` in light mode, 4px radius, 2px padding, same outer size as other icons so nodes stay aligned.

The result is recorded per slug, so a reviewer can see and override it:

```json
"nextjs":  { "source": "simple-icons", "name": "nextdotjs", "dark": { "fill": "ink" } },
"aws-ec2": { "source": "aws", "name": "Arch_Amazon-EC2_64", "dark": { "file": "Arch_Amazon-EC2_64_Dark" } },
"bun":     { "source": "devicon", "name": "bun-original", "light": { "tile": true } }
```

An entry written by hand in `catalog-icons.json` wins over detection.

**Files.** `<slug>.svg` is the default; `<slug>.dark.svg` and `<slug>.light.svg` exist only where needed. The script also writes `manifest.json` listing which slugs have which variant, so the app never requests a file that does not exist.

**At runtime.** One `CatalogIcon` component picks the file from the resolved theme (`.dark` on `<html>`, set by `theme-provider`) and the manifest, and swaps it when the theme changes. Palette, canvas, properties panel, "Used in" and public view all use it.

**Export.** PNG and SVG are drawn in the theme on screen, with that theme's icon files embedded, so the file looks the same wherever it is opened; switch the theme first to export the other one.

**Check.** The coverage test also fails when an icon is flagged faint for a theme and has no variant or tile for it.

### Build

`scripts/catalog-icons` runs when entries are added, not on every build:

1. Reads the slugs from the catalog seed and `catalog-icons.json` (`slug → source, icon name, variant, licence`).
2. Takes the SVG from the npm package (`simple-icons`, `devicon`), the unpacked cloud icon set, or `scripts/catalog-icons/manual/` for press-kit logos.
3. Optimises it (SVGO, viewBox kept, IDs prefixed by slug so two icons on one page do not clash), applies the light and dark rule above, and writes `<slug>.svg`, any `<slug>.dark.svg` / `<slug>.light.svg`, and `manifest.json`.
4. Writes `frontend/src/assets/catalog/ICON-SOURCES.md` with each icon's source and licence.

A test fails when an entry that is not deprecated has neither an icon file nor a Lucide fallback listed in `catalog-icons.json`.

### Not done

- No icon upload per node or per workspace.
- No monochrome mode for logos.

## Not in the catalog

- CI/CD and source control as running parts (GitHub Actions, Jenkins, Argo CD): the canvas draws the running system, not how it is built. `github` and `gitlab` are listed only as APIs a System calls.
- Libraries, ORMs and build tools (Vite, Webpack, GORM, Prisma): put them in the System's description.
- Versions of anything.
