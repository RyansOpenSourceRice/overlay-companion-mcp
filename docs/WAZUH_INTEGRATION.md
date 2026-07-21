# Wazuh / SIEM Integration

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

> **Scope.** This app ships **log shipping** and **detection rules** so a
> deployer can forward its logs to an external Wazuh instance. The app does
> **not** build, bundle, or run Wazuh. The admin runs Wazuh separately (it is
> an external compose). This integration is available to **all** deployers —
> nothing here is behind a paywall. "Enterprise tier" means features that help
> everyone, including what companies need.

This follows Ryan's preferences §8 (Cybersecurity — SIEM/XDR, self-hostable,
vendor-neutral traces, portable Sigma-style rules, simple log shipping) and §7
(scanners fix problems they find; no active hunting).

## What the app emits

The management server (`infra/server`) and the C# MCP server (`src`) both emit
**structured JSON Lines (JSONL)** logs: one event per line, stable field names.
Per §9 (Logs — built for AI, not people), each line includes:

- `timestamp` (UTC, ISO 8601 with `Z`)
- `level` (`debug` / `info` / `warn` / `error`)
- `message`
- `trace_id`, `span_id`
- `fields` (event-specific)

Security-relevant events are also written to the SurrealDB `audit_log` table
(login success/failure, logout, account deletion, config changes, connection
tests). The audit log is the authoritative record; the JSONL stream is what gets
shipped to Wazuh.

## Enabling log shipping (GUI-first)

Per §9 (Configuration: GUI-first), log shipping is an admin-enabled option in
the **Settings → Wazuh / SIEM log shipping** card:

1. Sign in as an admin.
2. Open **Settings**.
3. In the **Wazuh / SIEM log shipping** card, toggle **Enable log shipping**.
4. Enter the **Wazuh endpoint** (the Filebeat/Wazuh collector URL).
5. Enter the **API key** if your collector requires one.
6. Save.

The setting is stored in SurrealDB `app_config` under `wazuh.shipper` and is
hot-applied. Env vars (`WAZUH_ENABLED`, `WAZUH_ENDPOINT`) are bootstrap
defaults only.

## External Wazuh compose (admin-run)

The app does not include Wazuh. To run Wazuh, follow the official
[Wazuh quickstart](https://documentation.wazuh.com/current/getting-started/).
A minimal external compose the admin might use:

```yaml
# wazuh-external.yml — run separately from the Overlay Companion stack.
# The Overlay Companion app ships ONLY the shipper config + rules below.
version: '3.9'
services:
  wazuh-manager:
    image: wazuh/wazuh-manager:4.8.0
    hostname: wazuh-manager
    ports:
      - "1514:1514/udp"   # Syslog ingestion
      - "1515:1515"       # Agent enrollment
      - "55000:55000"     # Manager API
    environment:
      - INDEXER_URL=https://wazuh-indexer:9200
      - FILEBEAT_SSL_VERIFICATION_MODE=full
    volumes:
      - wazuh-manager-data:/var/ossec/data
      - ./wazuh-config:/wazuh-config:ro

  wazuh-indexer:
    image: wazuh/wazuh-indexer:4.8.0
    hostname: wazuh-indexer
    environment:
      - OPENSEARCH_JAVA_OPTS=-Xms1g -Xmx1g
    volumes:
      - wazuh-indexer-data:/var/lib/wazuh-indexer

  wazuh-dashboard:
    image: wazuh/wazuh-dashboard:4.8.0
    hostname: wazuh-dashboard
    ports:
      - "5601:5601"
    depends_on:
      - wazuh-indexer

volumes:
  wazuh-manager-data:
  wazuh-indexer-data:
```

## Log shipping config (Filebeat)

`infra/wazuh/filebeat-overlay-companion.yml` is the shipper config template.
Filebeat reads the app's JSONL logs and forwards them to the Wazuh manager.
Copy it into the Wazuh manager's Filebeat config and adjust the log paths.

## Sigma-style detection rules

`infra/wazuh/rules/` contains Sigma-style rules that Wazuh can decode to detect
security-relevant patterns in the app's logs:

- `failed_login_burst.yml` — multiple failed logins from one IP (brute force).
- `account_deleted.yml` — an account was deleted (data-loss signal).
- `config_changed.yml` — an admin changed auth/connection settings.

These are detection rules for the app's **own** audit events. Per §7/§28, the
scanners and rules do not actively hunt third-party systems.
