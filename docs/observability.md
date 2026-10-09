# Observability

Production sends its logs, metrics and traces to Grafana Cloud, where the operator reads them and gets alerts. Grafana Alloy collects everything on the VPS (`observability/config.alloy`); nothing is self-hosted and no port is opened for it.

It is for whoever runs Dokudocs, not for the people using it.

## What is collected

| | From | Notes |
| --- | --- | --- |
| Logs | every container of the stack | Labels: `service`, `level`, `env`. The API, collab and nginx write JSON lines; the API's health checks are dropped. |
| Metrics | API (`api:9091`), collab (`collab:1234/metrics`), the host, this stack's containers | Every 30 s. The API port is not published and nginx forwards only `/collab` to collab, so neither is reachable from outside. Host and container metrics are cut down to what the alerts and usual dashboards read. |
| Traces | API and collab, over OTLP to `alloy:4318` | Every trace with an error or slower than 1 s is kept, and 10% of the rest. |

The trace ID is the request ID: the API returns it as `X-Request-ID`, each log line of the request carries it as `trace_id`, and Grafana opens the trace from the line.

Never collected: request and response bodies, document content, emails, tokens, query strings, SQL parameter values, prompts. Logs keep the signed-in User's ID and the client IP (`CF-Connecting-IP`). Everything is kept for 14 days.

## Turning it on

1. In Grafana Cloud, open the stack's details page. From it, note for **Loki**, **Prometheus** and **OpenTelemetry (OTLP)**: the URL and the user (instance ID).
2. Create an access policy token with `logs:write`, `metrics:write` and `traces:write`.
3. Add to `.env` on the VPS:

   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318
   GRAFANA_CLOUD_API_KEY=glc_...
   GRAFANA_CLOUD_LOKI_URL=https://logs-prod-XXX.grafana.net/loki/api/v1/push
   GRAFANA_CLOUD_LOKI_USER=123456
   GRAFANA_CLOUD_PROMETHEUS_URL=https://prometheus-prod-XX-prod-XX.grafana.net/api/prom/push
   GRAFANA_CLOUD_PROMETHEUS_USER=1234567
   GRAFANA_CLOUD_OTLP_URL=https://otlp-gateway-prod-XX.grafana.net/otlp
   GRAFANA_CLOUD_OTLP_USER=123456
   ```

4. Start the stack with the profile. `api` and `collab` are recreated to pick up the endpoint:

   ```bash
   docker compose --profile observability up -d
   ```

Alloy mounts the Docker and containerd sockets, `/proc`, `/sys` and the root filesystem read-only, and shares the host's cgroup namespace, to find the containers and read their logs and usage. Access to the Docker socket amounts to root on the VPS, which is why Alloy is the only service with it.

Without the profile the stack runs as before. Leave `OTEL_EXPORTER_OTLP_ENDPOINT` empty then, or the API and collab try to send traces to an Alloy that is not running.

Alloy's own page (component health) is at port 12345 inside the compose network. To look at it from your machine: `ssh -L 12345:localhost:12345 vps` after adding `ports: ["127.0.0.1:12345:12345"]` to the `alloy` service.

## Finding things

- **One request:** take `X-Request-ID` from the response (browser devtools) and search Tempo for that trace ID, or Loki for `{env="production"} | json | trace_id="<id>"`.
- **Errors:** `{env="production", level="ERROR"}`.
- **A User's requests:** `{service="api"} | json | user_id="<uuid>"`.
- **Slow routes:** `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{service="api"}[5m])))`.

## Alerts

Create these in Grafana Cloud alerting, with the operator's email as the contact point.

| Alert | Query | For |
| --- | --- | --- |
| API errors | `sum(rate(http_requests_total{service="api",status=~"5.."}[5m])) / sum(rate(http_requests_total{service="api"}[5m])) > 0.05` | 5m |
| Service down | `up{service=~"api\|collab"} == 0` | 2m |
| Container restarting | `changes(container_start_time_seconds{container_label_com_docker_compose_service!=""}[15m]) > 2` | 0m |
| Disk filling | `1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} > 0.85` | 10m |
| collab full | `increase(collab_refused_total{reason="busy"}[5m]) > 0` | 0m |
| No metrics arriving | `absent_over_time(up{service="api"}[10m])` | 0m |
| No logs arriving | Loki: `absent_over_time({service="api"}[15m])` | 0m |

## Limits

The free tier allows about 10k active series, 50 GB of logs and 50 GB of traces a month, kept 14 days. A test run of the stack produced about 550 series (host about 330, containers about 35, API and collab about 165). Metric labels hold route patterns, never raw paths, so the API's series stay bounded. If the count grows, look at the `keep` rules in `observability/config.alloy` first.
