import * as appInsights from 'applicationinsights';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
  appInsights
    .setup()
    .setAutoCollectConsole(true, true)
    .setSendLiveMetrics(true)
    .start();
}

// Ohne gesetzte Keys registrieren wir keinen Span-Processor, der globale
// OpenTelemetry-Tracer bleibt der No-Op-Tracer aus @opentelemetry/api.
// startActiveObservation()/propagateAttributes() aus @langfuse/tracing (siehe
// agent.service.ts) rufen dann weiterhin klaglos durch, erzeugen aber keine
// echten Spans und senden nichts - kein Sonderfall im Agent-Code nötig, damit
// das Projekt auch ohne Langfuse-Account läuft.
if (process.env.LANGFUSE_SECRET_KEY && process.env.LANGFUSE_PUBLIC_KEY) {
  new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  }).start();
}
