# Overlay Companion MCP — Helm chart

Deploys the Overlay Companion MCP management server (web frontend + TS server,
the "solo app container" from `infra/Dockerfile.server`) on Kubernetes, with
SurrealDB (the only database, §9) and optional OpenFGA (fine-grained
authorization, D-017). It mirrors `infra/compose.minimal.yml` so the same
configuration works under podman/docker compose and Kubernetes.

## Install

```bash
helm install overlay-companion infra/helm/overlay-companion \
  --set config.betterAuthSecret="$(openssl rand -base64 48)"
```

## Access

```bash
kubectl port-forward svc/overlay-companion 8080:8080
# then open http://localhost:8080
```

Or enable the Ingress:

```bash
helm install overlay-companion infra/helm/overlay-companion \
  --set config.betterAuthSecret="$(openssl rand -base64 48)" \
  --set ingress.enabled=true \
  --set ingress.host=overlay.example.com \
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=overlay-tls
```

## OpenFGA

OpenFGA is optional and disabled by default (owner-scoped authorization). To
deploy it in-cluster and enable enforcement:

```bash
helm install overlay-companion infra/helm/overlay-companion \
  --set config.betterAuthSecret="$(openssl rand -base64 48)" \
  --set openfga.enabled=true
```

The app provisions the OpenFGA store + authorization model on boot and writes
the creator as the connection owner; read/update/delete/test/touch are gated by
fail-closed `Check()` (viewer/operator/owner). You can also run OpenFGA outside
the cluster and set `OPENFGA_URL` via an external config.

## External SurrealDB

To use an existing SurrealDB instead of the in-cluster StatefulSet:

```bash
helm install overlay-companion infra/helm/overlay-companion \
  --set surrealdb.enabled=false \
  --set surrealdb.externalUrl=http://surrealdb.example.com:8000 \
  --set surrealdb.username=root \
  --set surrealdb.password=your-password
```

## Values

See `values.yaml` for the full reference. Key settings:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.betterAuthSecret` | Session-signing secret (required in prod) | `""` |
| `config.adminEmail` | Email granted the admin role on login | `""` |
| `surrealdb.enabled` | Deploy the in-cluster SurrealDB StatefulSet | `true` |
| `openfga.enabled` | Deploy OpenFGA + enable enforcement | `false` |
| `ingress.enabled` | Expose via Ingress | `false` |