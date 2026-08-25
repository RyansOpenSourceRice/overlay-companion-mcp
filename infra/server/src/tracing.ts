/**
 * OpenTelemetry bootstrap (tracing).
 *
 * Imported FIRST in server.ts so instrumentation wraps all downstream
 * imports. Tracing is opt-in: it activates when OTEL_ENABLED === "true" and
 * OTEL_EXPORTER_OTLP_ENDPOINT is set. Spans are exported via OTLP/HTTP to a
 * backend (Jaeger, Tempo, Traceloop…), where the OpenTelemetry MCP server can
 * query them — letting an agent "see what the user did" and surface errors.
 *
 * Env:
 *   OTEL_ENABLED                  "true" to activate
 *   OTEL_EXPORTER_OTLP_ENDPOINT   base URL, e.g. http://jaeger-otel:4318
 *   OTEL_SERVICE_NAME             service label (default overlay-companion-server)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();
const enabled = process.env.OTEL_ENABLED === 'true' && endpoint.length > 0;

if (enabled) {
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
  console.log(`[tracing] OpenTelemetry enabled -> ${endpoint}`);
}
