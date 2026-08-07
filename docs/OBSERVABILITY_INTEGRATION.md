# Observability Integration (OpenRouter Broadcast → your stack)

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

> **Scope.** Phase D. Observability is **not** part of the Overlay Companion
> deploy stack. Like the Wazuh integration, this project ships **config and a
> compose** so a deployer who already runs (or wants to run) an observability
> stack can point **OpenRouter's Broadcast** at a self-hosted OTLP endpoint.
> This app never ingests those traces itself.

## Why this exists

The in-app assistant (Phase B) and any external agent call models through
OpenRouter. OpenRouter's **Broadcast** feature (Settings → Observability in your
OpenRouter account) emits an **OpenTelemetry trace** for every request, with
`gen_ai.*` attributes (model, provider, tokens, cost, latency, finish reason).
Broadcast is configured on the **OpenRouter dashboard** and forwards to a
destination you host. The Overlay Companion code is unchanged.

This is exactly the Wazuh model: the app ships glue so OTHERS can deploy what
they need if they already have stacks.

## What is included

`infra/observability/` provides a self-hostable OSS set:

| Component | Purpose | Endpoint |
| --- | --- | --- |
| OpenTelemetry Collector | universal OTLP intake (`:4318` HTTP) | the Broadcast destination |
| SigNoz | traces/metrics/logs dashboard + alerts | `http://<host>:3301` |
| Grafana LGTM + Alloy | Tempo traces / Loki logs / Mimir metrics | `http://<host>:3000` |
| Langfuse | LLM tracing, evals, cost tracking | `http://<host>:3333` |

## Quick start (deployer)

1. `cd infra/observability && cp .env.example .env` and set the secrets.
2. `docker compose up -d otel-collector signoz` (or the subset you already use).
3. In your **OpenRouter dashboard** → Settings → Observability:
   - Toggle **Broadcast** on.
   - Add destination → **OpenTelemetry Collector** → endpoint
     `http://<your-host>:4318/v1/traces` (OTLP HTTP).
   - Click **Test Connection**, then **Send Trace**.
4. Query in SigNoz (`{ resource.service.name = "openrouter" }`) or Langfuse.

## Correlating traces with your workflows

OpenRouter passes through a `trace` metadata field on requests. Use it to group
spans in your backend:

```json
{
  "model": "openai/gpt-4o",
  "trace": {
    "trace_id": "workflow_12345",
    "trace_name": "Overlay annotation session",
    "span_name": "Assist turn",
    "generation_name": "Chat completion",
    "environment": "production",
    "feature": "in-app-assistant"
  }
}
```

Keys like `trace_id`, `trace_name`, `span_name`, `generation_name`, and
`parent_span_id` are honored by Langfuse / LangSmith / Grafana / Datadog.

## Notes

- **Sampling** and **per-key filtering** are configured per-destination in the
  OpenRouter dashboard, not in the app.
- The `otel-collector` always enables a `debug` exporter so you can confirm
  traces arrive even before a backend is ready.
- **Secrets.** `.env.example` values are bootstrap defaults; override all of
  them before any non-local exposure. `gitleaks` (pre-commit) will flag a
  committed `.env`.
- **Grafana Tempo** and **Alloy** share the OTLP ports (`:4317`/`:4318`) with
  the standalone collector — enable only the intake you actually run, or remap
  ports, to avoid conflicts.
