#!/usr/bin/env python3
"""Generate docs/ontology/project.ontology.ttl for Overlay Companion MCP.

Uses rdflib so output is always valid Turtle and deterministically sorted
(subject, predicate, object) — the same tooling the pre-commit hook enforces.
"""

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, RDFS, XSD

ONTO = Namespace("https://github.com/RyansOpenSourceRice/overlay-companion-mcp/onto#")
PROJ = URIRef("https://github.com/RyansOpenSourceRice/overlay-companion-mcp")
VERSION = "v1.0.0"
UPDATED = Literal("2026-08-22T00:00:00Z", datatype=XSD.dateTime)

g = Graph()

# --------------------------------------------------------------------------
# Metadata
# --------------------------------------------------------------------------
g.add((ONTO[""], RDF.type, ONTO["Project"]))
g.add((ONTO[""], RDFS.label, Literal("Overlay Companion MCP Project Ontology")))
g.add((ONTO[""], ONTO["version"], Literal(VERSION)))
g.add((ONTO[""], ONTO["updatedAt"], UPDATED))
g.add((ONTO[""], ONTO["sourceRepo"], PROJ))
g.add((ONTO[""], ONTO["projectName"], Literal("Overlay Companion MCP")))
g.add((ONTO[""], ONTO["repoUrl"], PROJ))
g.add(
    (
        ONTO[""],
        ONTO["description"],
        Literal(
            "A general-purpose, human-in-the-loop AI-assisted screen interaction "
            "toolkit. The annotation layer, not the VM."
        ),
    )
)
g.add((ONTO[""], ONTO["status"], Literal("active")))

# --------------------------------------------------------------------------
# Schema: classes
# --------------------------------------------------------------------------
classes = {
    "Project": "A software project or repository tracked by this ontology.",
    "Decision": "An archived design or architecture decision (ADR-style).",
    "QualityRule": "A rule used to validate quality across the system.",
    "Problem": "An unsolved, open, or deferred problem.",
    "Component": "A system part or module.",
    "Session": "A record of an agent work session for cross-session handoff.",
    "Agent": "An AI agent or tool that produced work on the project.",
    "Risk": "A security or quality risk with its mitigations.",
    "Skill": "An external agent skill this project references (registered in the "
    "skill conglomerate ontology).",
    "Milestone": "A roadmap milestone or development phase.",
    "Tool": "An MCP tool exposed by the project.",
    "Protocol": "A remote-desktop protocol supported by the project.",
    "Person": "A human collaborator.",
    "TestResult": "A recorded test or validation outcome.",
}
for name, desc in classes.items():
    c = ONTO[name]
    g.add((c, RDF.type, RDFS.Class))
    g.add((c, RDFS.label, Literal(name)))
    g.add((c, RDFS.comment, Literal(desc)))

# --------------------------------------------------------------------------
# Schema: properties
# --------------------------------------------------------------------------
props = {
    # metadata
    "version": "Version string of the ontology or artifact.",
    "createdAt": "Creation timestamp.",
    "updatedAt": "Last update timestamp.",
    "title": "Human-readable title.",
    "description": "Human-readable description.",
    "status": "Lifecycle status (active, locked, superseded, open, closed, ...).",
    "sourceRepo": "The repository this ontology describes.",
    # Project
    "projectName": "Display name of the project.",
    "repoUrl": "URL of the project repository.",
    "hasDecision": "Links a Project to a Decision.",
    "hasQualityRule": "Links a Project to a QualityRule.",
    "hasProblem": "Links a Project to a Problem.",
    "hasComponent": "Links a Project to a Component.",
    "hasSession": "Links a Project to a Session.",
    "hasRisk": "Links a Project to a Risk.",
    "hasMilestone": "Links a Project to a Milestone.",
    "hasTool": "Links a Project to a Tool.",
    "hasProtocol": "Links a Project to a Protocol.",
    "hasSkill": "Links a Project to an external agent Skill (from the skill "
    "conglomerate).",
    "hasPerson": "Links a Project to a Person.",
    "hasTestResult": "Links a Project to a TestResult.",
    # Decision
    "rationale": "Why the decision was made.",
    "alternatives": "Rejected alternatives considered.",
    "consequences": "Known consequences of the decision.",
    "supersedes": "A Decision this one supersedes.",
    "supersededBy": "A Decision that supersedes this one.",
    "relatesTo": "Generic relationship to another resource.",
    # QualityRule
    "appliesTo": "The Component or area a rule applies to.",
    "check": "How to validate the rule (tool, command, or procedure).",
    "severity": "error | warning | info.",
    # Problem
    "workaround": "Known workaround for an open problem.",
    "blockedBy": "A Problem or Milestone that blocks this one.",
    # Session
    "agentName": "Name of the agent or tool that ran the session.",
    "timestamp": "When the session occurred.",
    "summary": "What the session accomplished.",
    "openQuestions": "Questions left open at session end.",
    "references": "Resources the session produced or consumed.",
    "referencesExternalSkill": "Links a Skill node to its external agent skill in "
    "the skill conglomerate ontology.",
    # Agent
    "agentType": "opencode | openhands | other.",
    # Component
    "path": "Filesystem path or container name of the component.",
    "purpose": "What the component does.",
    "dependsOn": "A Component this one depends on.",
    # Tool
    "toolName": "MCP tool name.",
    "toolDescription": "What the MCP tool does.",
    # Protocol
    "protocolName": "Protocol name (KasmVNC, VNC, RDP).",
    "port": "Default port.",
    "recommended": "Whether this is the recommended option.",
    # Milestone
    "milestoneName": "Milestone name.",
    "milestoneOrder": "Ordinal position of the milestone.",
    # Person
    "personName": "Human name (first name only per preferences).",
    "role": "Role of the person on the project.",
    # TestResult
    "testName": "Test or suite name.",
    "testOutcome": "pass | fail | pending.",
}
for name, desc in props.items():
    p = ONTO[name]
    g.add((p, RDF.type, RDF.Property))
    g.add((p, RDFS.label, Literal(name)))
    g.add((p, RDFS.comment, Literal(desc)))


def add(sub, pred, obj):
    g.add((ONTO[sub], ONTO[pred], obj))


def add_uri(sub, pred, obj):
    g.add((ONTO[sub], ONTO[pred], ONTO[obj]))


def typed(sub, cls, title, **extra):
    g.add((ONTO[sub], RDF.type, ONTO[cls]))
    g.add((ONTO[sub], ONTO["title"], Literal(title)))
    for k, v in extra.items():
        if isinstance(v, URIRef):
            g.add((ONTO[sub], ONTO[k], v))
        else:
            g.add((ONTO[sub], ONTO[k], Literal(v)))


# --------------------------------------------------------------------------
# Decisions (from DESIGN.md)
# --------------------------------------------------------------------------
decisions = [
    (
        "D-001",
        "container-web-viewer",
        "Container + web viewer (locked)",
        "The project is the annotation layer, not the VM. Overlays render in a "
        "web viewer, not composited over the desktop, so it works on any VM "
        "reachable via browser tech.",
        "wlroots host app, GNOME Shell extension, flatpak",
        "Portability across VMs; no host overlay app.",
    ),
    (
        "D-002",
        "annotation-not-autopilot",
        "AI is an annotation layer, not an autopilot",
        "No click/type/keyboard MCP tools. AI screenshots, analyzes, draws "
        "overlays, and recommends; the human clicks and types.",
        "Full input-simulation MCP tools",
        "Safety-by-design; avoids duplicating an input MCP.",
    ),
    (
        "D-003",
        "surrealdb-only-database",
        "SurrealDB is the only database",
        "SurrealDB backs users, sessions, connections, audit log, and app config. "
        "Decoupled service in infra/compose.yml. File storage fallback on outage.",
        "PostgreSQL, separate cache",
        "One database; no cache unless benchmarked.",
    ),
    (
        "D-004",
        "oidc-keycloak-local-fallback",
        "OIDC via Keycloak + local fallback",
        "Never roll our own identity. Keycloak provides passkeys/TOTP/backup "
        "codes. Argon2id local fallback; legacy scrypt auto-upgraded. Sign-ups "
        "locked by default.",
        "Custom identity service",
        "OWASP-recommended password hashing; admin opt-in sign-ups. Superseded "
        "by D-014 (Better Auth).",
    ),
    (
        "D-014",
        "better-auth-auth",
        "Better Auth in-app authentication",
        "Replaces the hand-rolled OIDC/Argon2id auth with Better Auth (mounted "
        "at /api/auth), backed by SurrealDB via the surreal-better-auth "
        "adapter. Email/password, passkeys/WebAuthn, TOTP, RBAC, and social "
        "OAuth are Better Auth features. ADMIN_EMAIL grants the admin role. "
        "Per §7 default for in-app auth.",
        "Hand-rolled OIDC via Keycloak + Argon2id local fallback (D-004)",
        "No self-authored identity/crypto; the auth engine is a maintained "
        "component; the web client and Playwright suite use Better Auth native "
        "endpoints.",
    ),
    (
        "D-015",
        "optional-passkey-totp",
        "Optional passkeys + TOTP via Better Auth plugins",
        "Enables Better Auth's passkey (WebAuthn / hardware keys) and two-factor "
        "(TOTP) plugins, gated by §7 as optional per-account opt-ins. The server "
        "serves /api/auth/passkey/* and /api/auth/two-factor/*; the SPA reflects "
        "availability in the Settings > Two-factor security card. Neither method "
        "is forced at sign-up; password + passkey + TOTP combine for a self-hosted "
        "defense-in-depth posture.",
        "Hand-rolled OTP/WebAuthn or a second identity provider",
        "Maintained, audited plugin surface from the existing auth engine; no "
        "self-authored crypto; matches D-004/D-014's never-roll-your-own-identity.",
    ),
    (
        "D-016",
        "data-access-layer-store-boundary",
        "Data-access layer: store boundary",
        "All management-server data access routes through a single store "
        "boundary, SurrealDbStore (surreal-store.ts). No raw driver/SurrealQL "
        "outside it; engine specifics live in one place, DB is testable/swappable "
        "without rewriting business logic. The one sanctioned exception is "
        "Better Auth's surreal-better-auth adapter, which owns its own user/session "
        "schema; it reuses the store's loadSurrealOptions() so DB connection config "
        "has a single source of truth.",
        "Scattered raw driver calls through route handlers and services",
        "Single DAL; cheaper to swap/test the DB; one place for connection "
        "lifecycle, transactions, and error mapping.",
    ),
    (
        "D-017",
        "openfga-fine-grained-authorization",
        "OpenFGA is the fine-grained authorization service",
        "OpenFGA (a separate service, never embedded in the app) is the "
        "authorization boundary for saved connections. Model schema 1.1: "
        "connection has owner/operator/viewer relations (owner written on "
        "create; operator/viewer forward-looking). Enforcement is fail-closed "
        "Check() on read/update/delete/test/touch, ListObjects(viewer) for "
        "listing. GUI-first and opt-in via Settings (app_config category "
        "'openfga', bootstrap env defaults); disabled by default keeps the "
        "owner-scoped behavior. Better Auth stays identity+RBAC; OpenFGA adds "
        "relationship-based per-object authorization.",
        "Hand-rolled per-object checks in route handlers, or embedding an "
        "authorization engine into the app",
        "Reuses a maintained Zanzibar-style engine; GUI-first opt-in; no "
        "self-authored authz logic; complements (does not replace) Better Auth.",
    ),
    (
        "D-018",
        "theme-system-light-dark",
        "Theme system: auto light/dark + manual toggle",
        "The web UI uses a design-token theme system (theme.css) with light and "
        "dark palettes. Default is auto-follow: the app follows the OS/browser "
        "prefers-color-scheme with no manual action. A header toggle cycles "
        "auto -> light -> dark and persists the choice in localStorage "
        "(oc-theme), applied before first paint to avoid a flash. The login "
        "view is a split layout (brand/artwork panel + sign-in/register panel) "
        "with themed SVG backgrounds (bg-light.svg / bg-dark.svg) showing "
        "miniature screens with circles, dots, and arrows. Matches Ryan's "
        "preferences §4 Themes (auto-follow + secondary manual toggle).",
        "Single fixed color scheme; no theme system",
        "Accessible and on-brand in both OS modes; auto-follow reduces user "
        "effort while the manual toggle preserves control; token-based so "
        "custom/high-contrast themes are a documented extension.",
    ),
    (
        "D-019",
        "assistant-ui-frontend-chat",
        "Frontend AI chat UI: assistant-ui + Vercel AI SDK",
        "For in-app AI chat windows in TypeScript, the default stack is "
        "assistant-ui (React, MIT) on top of the Vercel AI SDK — the standard "
        "conversation-UI toolkit (ChatGPT-style UX, shadcn/ui, streaming/"
        "retries/scroll handled). This is the 'Better Auth of AI chat UI'. The "
        "current in-app chat is plain TypeScript and stays until a React chat "
        "surface is warranted; assistant-ui + AI SDK is then the default.",
        "NLUX, Deep Chat, CopilotKit, hand-rolled vanilla-TS chat, full apps "
        "(LibreChat / Chatbot UI)",
        "Adopts a maintained, widely-used composition model rather than owning "
        "chat scroll/focus/streaming edge cases; matches Ryan's preference.",
    ),
    (
        "D-020",
        "per-view-urls-not-silent-spa",
        "Each view gets its own URL (no silent single-page routing)",
        "The web UI exposes a URL per view (e.g. #/connections, #/settings) "
        "rather than a single silent-SPA URL with no addressable location. A "
        "view without a URL is a navigation and deep-linking gap: users cannot "
        "bookmark, link, share, or use back/forward reliably.",
        "One URL with JS-only tab switching and no history entries",
        "Bookmarkable, deep-linkable, shareable views; matches Ryan's "
        "preference (a view without a URL was not intended).",
    ),
    (
        "D-005",
        "server-persisted-connections",
        "Saved connections are server-persisted",
        "VM connections live in SurrealDB connection table via /api/connections, "
        "scoped to the authenticated user. Plaintext passwords never stored.",
        "Browser localStorage only",
        "Persistence across devices; Argon2id password hashes.",
    ),
    (
        "D-006",
        "gui-first-config",
        "GUI-first config",
        "Auth/connection/provider/Wazuh/TLS settings live in the web Settings UI "
        "backed by SurrealDB app_config. Env vars are bootstrap defaults only.",
        "CLI/env-first configuration",
        "Config intelligible to both humans and AI agents.",
    ),
    (
        "D-007",
        "https-acme-caddy-traefik",
        "HTTPS is ACME, terminated by Caddy or Traefik",
        "Management server stays HTTP behind a terminator. ACME public or private "
        "(step-ca), uploaded cert, or self-signed fallback. Both terminators are "
        "first-class.",
        "TLS in the app server itself",
        "Server identity managed in Settings; configurable ports.",
    ),
    (
        "D-008",
        "wazuh-external",
        "Wazuh is external",
        "Wazuh is an external compose the admin runs. The app ships log shipping "
        "(Filebeat) and Sigma-style rules; it does not build or bundle Wazuh.",
        "Bundled Wazuh",
        "No paywall; enterprise tier means features that help everyone.",
    ),
    (
        "D-009",
        "csharp-playwright-tests",
        "C# Playwright tests",
        "Playwright is the web E2E framework, superseding Appium. C# remains the "
        "implementation language. FireFox in CI. Overlays carry a semantic layer.",
        "Appium, Python ai-gui harness",
        "Browser-based product; trace viewer invaluable in CI.",
    ),
    (
        "D-010",
        "in-app-chat-second-client",
        "In-app chat is a second client to the same MCP tools",
        "The built-in chat panel streams an OpenRouter completion and executes a "
        "bounded tool allowlist against the C# /mcp endpoint. Not a new agent "
        "surface.",
        "Separate chat agent with its own tools",
        "Annotation-not-autopilot holds for both clients.",
    ),
    (
        "D-011",
        "display-ownership-token",
        "Display-ownership token prevents dual canvas ownership",
        "Only the active owner may draw. Owner persisted in SurrealDB "
        "general.activeActor; switching releases the other actor's overlays.",
        "No ownership model",
        "Prevents interior and exterior agents fighting over the canvas.",
    ),
    (
        "D-012",
        "templates-accessible-semantics",
        "Templates and accessible semantics",
        "AI references named templates plus a small parameter set instead of "
        "re-emitting SVG/geometry. Overlays carry roles + accessible names in a "
        "queryable semantic tree.",
        "Raw SVG/geometry emission",
        "CI asserts on meaning, not pixels; screen-reader usable.",
    ),
    (
        "D-013",
        "observability-glue-for-others",
        "Observability is glue for OTHERS",
        "Ships compose + config so a deployer can point OTLP traces at their own "
        "stack (OTel Collector, SigNoz, Grafana LGTM + Alloy, Langfuse).",
        "Bundled observability stack",
        "Like Wazuh, not in the app's deploy stack.",
    ),
]
for i, (did, slug, title, rationale, alt, cons) in enumerate(decisions, 1):
    sub = f"Decision-{did}-{slug}"
    typed(
        sub,
        "Decision",
        title,
        decisionId=did,
        status="accepted",
        rationale=rationale,
        alternatives=alt,
        consequences=cons,
    )
    add_uri(sub, "relatesTo", "Project")
    add_uri("Project", "hasDecision", sub)

# --------------------------------------------------------------------------
# QualityRules (from AGENTS.md)
# --------------------------------------------------------------------------
rules = [
    (
        "QR-001",
        "no-click-type-keyboard-tools",
        "No click/type/keyboard MCP tools",
        "MCP server",
        "grep src/MCP/Tools for input-simulation tools",
        "error",
        "Safety-by-design; annotation layer only.",
    ),
    (
        "QR-002",
        "owasp-top-10-baseline",
        "OWASP Top 10 baseline",
        "All components",
        "OpenGrep SAST + dependency review in CI",
        "error",
        "Security baseline for the whole system.",
    ),
    (
        "QR-003",
        "rate-limit-auth-endpoints",
        "Rate-limit auth endpoints",
        "Management server",
        "express-rate-limit tiers",
        "error",
        "CWE-307 mitigation.",
    ),
    (
        "QR-004",
        "signups-locked-default",
        "Sign-ups locked by default",
        "Auth",
        "admin opt-in registration setting",
        "error",
        "Prevents open registration.",
    ),
    (
        "QR-005",
        "delete-account-feature",
        "Delete-account is a feature",
        "Auth",
        "account deletion flow in Settings",
        "error",
        "GDPR/CCPA data deletion.",
    ),
    (
        "QR-006",
        "passkeys-via-keycloak",
        "Passkeys/TOTP/backup codes via Keycloak",
        "Auth",
        "Keycloak realm configuration",
        "error",
        "Never roll our own identity.",
    ),
    (
        "QR-007",
        "required-scanners",
        "Required scanners: Trivy, OpenGrep, Gitleaks",
        "CI/CD",
        "Trivy (containers), OpenGrep (SAST), Gitleaks (secrets)",
        "error",
        "Scanners fix problems they find; they never hunt.",
    ),
    (
        "QR-008",
        "never-commit-secrets",
        "Never commit API keys",
        "Repository",
        "Gitleaks in pre-commit",
        "error",
        "The only secret gate is gitleaks in pre-commit.",
    ),
    (
        "QR-009",
        "precommit-is-gate",
        "Pre-commit is the gate",
        "CI/CD",
        "pre-commit run --all-files in CI",
        "error",
        "CI/CD runs pre-commit; no parallel secret gate.",
    ),
    (
        "QR-010",
        "language-placement",
        "Language placement: C# where feasible",
        "All components",
        "C# for MCP server + tests, TS for web, Rust for "
        "clipboard bridge only, no Python for production",
        "error",
        "Memory-safe OO where feasible.",
    ),
    (
        "QR-011",
        "gui-first-config",
        "GUI-first config",
        "All components",
        "Settings UI backed by SurrealDB app_config",
        "warning",
        "Env vars are bootstrap defaults only.",
    ),
    (
        "QR-012",
        "ai-disclosure-trailer",
        "AI disclosure + Co-authored-by trailer",
        "Repository",
        "AI disclosure note and Co-authored-by trailer on PRs",
        "warning",
        "Vendor-agnostic naming of the agent tool used.",
    ),
    (
        "QR-013",
        "first-name-only",
        "First name only in committed artifacts",
        "Repository",
        "grep committed artifacts for last name",
        "warning",
        "Last name is personal data, opt-in only.",
    ),
]
for i, (rid, slug, title, applies, check, sev, rat) in enumerate(rules, 1):
    sub = f"QualityRule-{rid}-{slug}"
    typed(
        sub,
        "QualityRule",
        title,
        ruleId=rid,
        status="active",
        appliesTo=applies,
        check=check,
        severity=sev,
        rationale=rat,
    )
    add_uri("Project", "hasQualityRule", sub)

# --------------------------------------------------------------------------
# Problems (from ROADMAP.md, INTEGRATION_TODO.md)
# --------------------------------------------------------------------------
problems = [
    (
        "P-001",
        "multi-monitor-support",
        "Multi-monitor support not implemented",
        "All operations assume single monitor (index 0). Critical for "
        "professional/enterprise use.",
        "high",
        "open",
        "get_display_info tool; monitor-aware overlays; runtime display detection.",
        "Component-001-csharp-mcp-server",
    ),
    (
        "P-002",
        "missing-mcp-tools",
        "Missing MCP tools: re_anchor_element, get_display_info",
        "13/15 documented tools implemented; two remain unimplemented.",
        "medium",
        "open",
        "Implement re_anchor_element and get_display_info.",
        "Component-001-csharp-mcp-server",
    ),
    (
        "P-003",
        "connection-mgmt-integration",
        "Connection management not registered in DI",
        "ConnectionManagementService and 5 tools exist but are not wired into "
        "Program.cs / tool registry.",
        "high",
        "open",
        "Register service + tools; verify 19-tool count; add unit tests.",
        "Component-001-csharp-mcp-server",
    ),
    (
        "P-004",
        "advanced-screenshot-verification",
        "Advanced screenshot verification",
        "OpenCV-based overlay detection and template matching not implemented.",
        "low",
        "open",
        "OpenCV image processing; color analysis.",
        "Component-001-csharp-mcp-server",
    ),
    (
        "P-005",
        "scenario-based-testing",
        "Scenario-based testing not wired up",
        "tests/ai-gui/scenarios/basic.yaml exists but is not automated.",
        "low",
        "open",
        "Wire YAML scenarios into E2E harness.",
        "TestResult-001-playwright-web-suite",
    ),
    (
        "P-006",
        "spa-per-view-urls-pending",
        "Per-view URLs implemented via hash routing",
        "D-020 records that every view needs a URL. Resolved: the web UI now "
        "uses hash routes (#/home, #/connections, #/settings, #/vm-view) with "
        "back/forward and deep-link support.",
        "medium",
        "closed",
        "Add hash-based routing (#/connections, #/settings, #/home) to the web UI.",
        "Component-C-003-web-interface",
    ),
    (
        "P-007",
        "otel-in-e2e-testing",
        "OpenTelemetry instrumented in E2E testing",
        "Resolved: the Playwright E2E workflow starts a Jaeger collector, enables "
        "OTel on the management server, and hard-fails when overlay-companion-server "
        "spans never reach Jaeger (no silent exporter outage).",
        "low",
        "closed",
        "Run a Jaeger/OTel collector in the E2E workflow and add a trace-collection "
        "or span-assertion step.",
        "TestResult-001-playwright-web-suite",
    ),
]
for pid, slug, title, desc, sev, status, work, relates in problems:
    sub = f"Problem-{pid}-{slug}"
    typed(
        sub,
        "Problem",
        title,
        problemId=pid,
        description=desc,
        severity=sev,
        status=status,
        workaround=work,
    )
    add_uri(sub, "relatesTo", relates)
    add_uri("Project", "hasProblem", sub)

# --------------------------------------------------------------------------
# Components (from ARCHITECTURE.md)
# --------------------------------------------------------------------------
components = [
    (
        "C-001",
        "csharp-mcp-server",
        "C# MCP server",
        "src/",
        "Sole MCP implementation with HTTP transport, overlay tools, screen "
        "capture, KasmVNC integration.",
    ),
    (
        "C-002",
        "ts-management-server",
        "TypeScript management server",
        "infra/server",
        "MCP proxy, WebSocket bridge, MCP configuration endpoint, TLS manager.",
    ),
    (
        "C-003",
        "web-interface",
        "Web interface",
        "infra/web",
        "Overlay visualization, connection management, credential handling.",
    ),
    (
        "C-004",
        "kasmvnc",
        "KasmVNC container",
        "infra/kasmvnc",
        "Web-native VNC server with multi-monitor support and WebSocket/WebRTC.",
    ),
    (
        "C-005",
        "caddy-proxy",
        "Caddy proxy",
        "infra/Caddyfile",
        "Unified access point routing to all services.",
    ),
    (
        "C-006",
        "surrealdb",
        "SurrealDB database",
        "infra/surrealdb",
        "Users, sessions, connections, audit log, app configuration.",
    ),
    (
        "C-007",
        "clipboard-bridge",
        "Rust clipboard bridge",
        "apps/clipboard-bridge-rust",
        "AI-automated clipboard access.",
    ),
]
for cid, slug, name, path, purpose in components:
    sub = f"Component-{cid}-{slug}"
    typed(sub, "Component", name, componentId=cid, path=path, purpose=purpose)
    add_uri("Project", "hasComponent", sub)

# Dependencies
g.add(
    (
        ONTO["Component-002-ts-management-server"],
        ONTO["dependsOn"],
        ONTO["Component-006-surrealdb"],
    )
)
g.add(
    (
        ONTO["Component-003-web-interface"],
        ONTO["dependsOn"],
        ONTO["Component-002-ts-management-server"],
    )
)
g.add(
    (
        ONTO["Component-004-kasmvnc"],
        ONTO["dependsOn"],
        ONTO["Component-005-caddy-proxy"],
    )
)
g.add(
    (
        ONTO["Component-001-csharp-mcp-server"],
        ONTO["dependsOn"],
        ONTO["Component-006-surrealdb"],
    )
)

# --------------------------------------------------------------------------
# Tools (from src/MCP/Tools/)
# --------------------------------------------------------------------------
tools = [
    "AddConnectionTool",
    "BatchOverlayTool",
    "CreateOverlayTool",
    "DrawOverlayTool",
    "GetClipboardBridgeStatusTool",
    "GetClipboardTool",
    "GetDisplayInfoTool",
    "GetOverlayCapabilitiesTool",
    "ListConnectionsTool",
    "ReAnchorElementTool",
    "RemoveConnectionTool",
    "RemoveOverlayTool",
    "SessionStopTool",
    "SetActiveConnectionTool",
    "SetClipboardTool",
    "SetDisplayActorTool",
    "SetModeTool",
    "SetScreenshotFrequencyTool",
    "SubscribeEventsTool",
    "TakeScreenshotTool",
    "TemplateOverlayTool",
    "TestConnectionTool",
    "UnsubscribeEventsTool",
]
for i, t in enumerate(tools, 1):
    sub = f"Tool-{i:03d}-{t}"
    typed(
        sub,
        "Tool",
        t,
        toolName=t,
        toolDescription=f"MCP tool {t} exposed by the C# MCP server.",
    )
    add_uri("Project", "hasTool", sub)

# --------------------------------------------------------------------------
# Protocols
# --------------------------------------------------------------------------
protocols = [
    (
        "KasmVNC",
        "6901",
        "true",
        "Web-native VNC with WebSocket/WebRTC; full " "multi-monitor support.",
    ),
    ("VNC", "5900-5909", "false", "Traditional VNC; single canvas display."),
    ("RDP", "3389", "false", "Windows Remote Desktop; username+password required."),
]
for name, port, rec, desc in protocols:
    sub = f"Protocol-{name}"
    typed(
        sub,
        "Protocol",
        name,
        protocolName=name,
        port=port,
        recommended=rec,
        description=desc,
    )
    add_uri("Project", "hasProtocol", sub)

# --------------------------------------------------------------------------
# Milestones (from ROADMAP.md)
# --------------------------------------------------------------------------
milestones = [
    ("M-001", "phase-1-mvp", "Phase 1: Core Infrastructure (MVP)", 1),
    ("M-002", "phase-2-integration", "Phase 2: Integration & Polish", 2),
    ("M-003", "phase-3-production", "Phase 3: Production Readiness", 3),
]
for mid, slug, name, order in milestones:
    sub = f"Milestone-{mid}-{slug}"
    typed(
        sub,
        "Milestone",
        name,
        milestoneId=mid,
        milestoneName=name,
        milestoneOrder=order,
        status="pending",
    )
    add_uri("Project", "hasMilestone", sub)

# --------------------------------------------------------------------------
# Risks
# --------------------------------------------------------------------------
risks = [
    (
        "R-001",
        "ssrf",
        "Server-Side Request Forgery",
        "Comprehensive SSRF protection with multiple validation layers.",
        "error",
    ),
    (
        "R-002",
        "xss",
        "Cross-Site Scripting (CWE-79)",
        "DOMPurify + he client-side; DOMPurify + JSDOM + validator.js server-side.",
        "error",
    ),
    (
        "R-003",
        "improper-encoding",
        "Improper Encoding (CWE-116)",
        "Multi-layer HTML entity encoding.",
        "error",
    ),
    (
        "R-004",
        "rate-limiting",
        "Rate Limiting (CWE-307)",
        "Tiered rate limiting: 100/15min general, 10/15min filesystem.",
        "error",
    ),
    (
        "R-005",
        "dual-canvas-ownership",
        "Dual canvas ownership conflict",
        "Display-ownership token in SurrealDB general.activeActor.",
        "warning",
    ),
]
for rid, slug, name, mit, sev in risks:
    sub = f"Risk-{rid}-{slug}"
    typed(
        sub, "Risk", name, riskId=rid, description=mit, severity=sev, status="mitigated"
    )
    add_uri("Project", "hasRisk", sub)

# --------------------------------------------------------------------------
# Persons
# --------------------------------------------------------------------------
typed("Person-001-Ryan", "Person", "Ryan", personName="Ryan", role="Owner and operator")
add_uri("Project", "hasPerson", "Person-001-Ryan")

# --------------------------------------------------------------------------
# Agents
# --------------------------------------------------------------------------
agents = [
    ("A-001", "opencode", "opencode", "The opencode CLI agent."),
    ("A-002", "openhands", "openhands", "The OpenHands agent."),
    ("A-003", "github-copilot", "github-copilot", "GitHub Copilot."),
]
for aid, slug, name, desc in agents:
    sub = f"Agent-{aid}-{slug}"
    typed(sub, "Agent", name, agentName=name, agentType=slug, description=desc)
    add_uri("Project", "hasAgent", sub)

# --------------------------------------------------------------------------
# Skills (external, registered in the skill conglomerate ontology)
# --------------------------------------------------------------------------
# Better Auth is the project's in-app authentication default (§7). It is a
# global skill, so this per-project ontology references it rather than
# redefining it.
external_skills = [
    (
        "SK1",
        "better-auth",
        "better-auth-create-auth",
        "https://gitlab.com/RyansOpenSourceRice/ryans_agent_skill_ontology_535/onto#Skill-better-auth",  # noqa: E501
        "TypeScript auth framework (email/password, OAuth, passkeys/WebAuthn, "
        "TOTP, RBAC). Per §7 default for in-app auth.",
    ),
]
for skillId, slug, skillName, externalUri, note in external_skills:
    sub = f"Skill-{skillId}-{slug}"
    typed(sub, "Skill", skillName, skillId=skillId, note=note)
    g.add((ONTO[sub], ONTO["referencesExternalSkill"], URIRef(externalUri)))
    add_uri("Project", "hasSkill", sub)

# --------------------------------------------------------------------------
# TestResults
# --------------------------------------------------------------------------
tests = [
    (
        "T-001",
        "playwright-web-suite",
        "Playwright web E2E suite",
        "C# Playwright tests running FireFox in CI.",
        "pass",
    ),
    (
        "T-002",
        "mcp-raw-json-functional",
        "MCP functional tests (McpRawJsonClient)",
        "Comprehensive functional testing of MCP tools.",
        "pass",
    ),
    (
        "T-003",
        "ci-cd-pipeline",
        "CI/CD pipeline",
        "Automated builds, pre-commit, SAST, container scans.",
        "pass",
    ),
]
for tid, slug, name, desc, outcome in tests:
    sub = f"TestResult-{tid}-{slug}"
    typed(
        sub,
        "TestResult",
        name,
        testId=tid,
        testName=name,
        description=desc,
        testOutcome=outcome,
    )
    add_uri("Project", "hasTestResult", sub)

# --------------------------------------------------------------------------
# Seed Session (this setup session)
# --------------------------------------------------------------------------
typed(
    "Session-001-ontology-setup",
    "Session",
    "Ontology setup session",
    sessionId="S-001",
    agentName="opencode",
    timestamp="2026-08-22T00:00:00Z",
    summary="Created the project ontology, AGENTS.md pointer, and rdflib "
    "pre-commit hook for Overlay Companion MCP.",
    openQuestions="Whether to add a third Fuseki dataset for this project "
    "as it grows.",
)
add_uri("Session-001-ontology-setup", "references", "Project")
add_uri("Project", "hasSession", "Session-001-ontology-setup")


# --------------------------------------------------------------------------
# Serialize deterministically sorted
# --------------------------------------------------------------------------
def sorted_triples(graph):
    return sorted(
        graph.triples((None, None, None)),
        key=lambda t: (str(t[0]), str(t[1]), str(t[2])),
    )


out = []
for s, p, o in sorted_triples(g):
    out.append(f"<{s}> <{p}> {o.n3()} .")
out.append("")
text = "\n".join(out)

with open("docs/ontology/project.ontology.ttl", "w") as f:
    f.write(text)

print(f"Wrote {len(out)-1} triples")
