/**
 * OpenTelemetry bootstrap (tracing) + a small helper for surfacing the
 * management server's own health / system-status as spans in the OTLP backend
 * (Jaeger…). The OpenTelemetry MCP server can then query, filter and alert on
 * these — so a degraded dependency (MCP server down, WebSocket disabled, etc.)
 * becomes visible in the trace store instead of only in the live /health JSON.
 *
 * Imported FIRST in server.ts so instrumentation wraps all downstream imports.
 * Tracing is opt-in: it activates when OTEL_ENABLED === "true" and
 * OTEL_EXPORTER_OTLP_ENDPOINT is set.
 *
 * Env:
 *   OTEL_ENABLED                  "true" to activate
 *   OTEL_EXPORTER_OTLP_ENDPOINT   base URL, e.g. http://jaeger-otel:4318
 *   OTEL_SERVICE_NAME             service label (default overlay-companion-server)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type { Tracer } from '@opentelemetry/api';

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();
export const tracingEnabled = process.env.OTEL_ENABLED === 'true' && endpoint.length > 0;

let tracer: Tracer | null = null;

if (tracingEnabled) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  const shutdown = (): void => {
    sdk.shutdown().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  sdk.start();
  tracer = trace.getTracer('overlay-companion-server');
  console.log(`[tracing] OpenTelemetry enabled -> ${endpoint}`);
}

/** Active tracer, or null when tracing is disabled (callers should no-op). */
export function getTracer(): Tracer | null {
  return tracer;
}

/** Status strings that mean a dependency is genuinely broken (→ span ERROR). */
const BROKEN_VALUES = new Set(['unavailable', 'unhealthy', 'down', 'disconnected', 'failed', 'error']);

/** Status strings that mean an optional dependency is turned off (→ note only). */
const OFF_VALUES = new Set(['disabled', 'unknown']);

function isBrokenStatus(key: string, value: unknown): boolean {
  if (key === 'connectedClients') return false; // a numeric count, not a status
  if (typeof value !== 'string') return false;
  return BROKEN_VALUES.has(value);
}

// Previous sample, keyed by service name — lets us emit a span event when a
// dependency flips healthy <-> degraded (the most useful "what broke" signal).
const previousSample = new Map<string, string | number>();

/**
 * Record one system-health sample as an OpenTelemetry span.
 *
 * Every call emits a `health_check` span carrying one attribute per service
 * (`health.mcpServer`, `health.kasmvnc`, …). If any dependency is degraded the
 * span is marked ERROR (with the offending services in the status message) and
 * gets a `unhealthy_dependencies` event; a service flipping state also emits a
 * `dependency_status_change` event. Filter Jaeger on `health.ok=false` (or the
 * span's error status) to surface "what went down".
 */
export function recordHealthCheck(services: Record<string, string | number | boolean | undefined>): void {
  if (!tracer) return;

  const span = tracer.startSpan('health_check');
  try {
    const broken: string[] = [];
    const off: string[] = [];

    for (const [key, value] of Object.entries(services)) {
      if (value === undefined) continue;
      span.setAttribute(`health.${key}`, String(value));

      if (isBrokenStatus(key, value)) {
        broken.push(`${key}=${value}`);
      } else if (typeof value === 'string' && OFF_VALUES.has(value)) {
        off.push(`${key}=${value}`);
      }

      const prev = previousSample.get(key);
      if (prev !== undefined && prev !== value) {
        span.addEvent('dependency_status_change', {
          dependency: key,
          from: String(prev),
          to: String(value),
          broken: isBrokenStatus(key, value),
        });
      }
      previousSample.set(key, value as string | number);
    }

    if (off.length > 0) span.setAttribute('health.optional_off', off.join(', '));

    if (broken.length > 0) {
      span.setAttribute('health.ok', false);
      span.setAttribute('health.degraded', broken.join(', '));
      span.setStatus({ code: SpanStatusCode.ERROR, message: `degraded: ${broken.join(', ')}` });
      span.addEvent('unhealthy_dependencies', { services: broken.join(', ') });
    } else {
      span.setAttribute('health.ok', true);
      span.setStatus({ code: SpanStatusCode.OK });
    }
  } finally {
    span.end();
  }
}

/**
 * Record an operational error/incident as an ERROR span, so actionable failures
 * (proxy errors, auth failures, DB outages) surface in the trace backend with a
 * searchable `error.*` shape rather than only in process logs.
 */
export function recordError(name: string, error: unknown, attributes: Record<string, string | number | boolean> = {}): void {
  if (!tracer) return;
  const err = error instanceof Error ? error : new Error(String(error));
  const span = tracer.startSpan(name);
  try {
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.recordException(err);
    for (const [k, v] of Object.entries(attributes)) span.setAttribute(k, v);
  } finally {
    span.end();
  }
}