/**
 * OpenFGA store for the management server.
 *
 * OpenFGA is the fine-grained authorization service (D-017). It is a separate
 * service — like SurrealDB and Keycloak — never embedded in the app (Ryan's
 * preference: 3rd-party services run as fit, not built in). This module is the
 * authorization boundary: it owns the authorization model, writes owner tuples
 * when a connection is created, and answers Check()/ListObjects() for the
 * connection routes.
 *
 * The store is OPT-IN (GUI-first config, §9): when OpenFGA is disabled the
 * existing owner-scoped behavior is unchanged (fail-open, no OpenFGA calls).
 * When enabled, enforcement is fail-closed: a Check() that cannot be answered
 * denies access rather than silently allowing it.
 *
 * The authorization model (schema 1.1):
 *   type user
 *   type connection
 *     relations
 *       define owner: [user]
 *       define operator: [user, connection#owner]
 *       define viewer: [user, connection#operator]
 * So the creator is the owner; operator/viewer are forward-looking relations
 * for future sharing/delegation. Today only owner tuples are written.
 */

import { OpenFgaClient, ClientConfiguration } from '@openfga/sdk';

export interface OpenFgaOptions {
  enabled: boolean;
  endpoint: string;
  storeId?: string;
  modelId?: string;
}

function envOrDefault(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export function loadOpenFgaOptions(): OpenFgaOptions {
  return {
    enabled: envOrDefault('OPENFGA_ENABLED', 'false') === 'true',
    endpoint: envOrDefault('OPENFGA_URL', 'http://openfga:8080'),
    storeId: process.env.OPENFGA_STORE_ID || undefined,
    modelId: process.env.OPENFGA_MODEL_ID || undefined,
  };
}

// The authorization model as the SDK expects it (writeAuthorizationModel body).
// schema 1.1 requires directly_related_user_types metadata for direct relations.
export const OPENFGA_MODEL = {
  schema_version: '1.1',
  type_definitions: [
    { type: 'user' },
    {
      type: 'connection',
      relations: {
        owner: { this: {} },
        operator: {
          union: {
            child: [
              { this: {} },
              { computedUserset: { object: '', relation: 'owner' } },
            ],
          },
        },
        viewer: {
          union: {
            child: [
              { this: {} },
              { computedUserset: { object: '', relation: 'operator' } },
            ],
          },
        },
      },
      metadata: {
        relations: {
          owner: { directly_related_user_types: [{ type: 'user' }] },
          operator: { directly_related_user_types: [{ type: 'user' }] },
          viewer: { directly_related_user_types: [{ type: 'user' }] },
        },
      },
    },
  ],
} as const;

export type ConnectionRelation = 'owner' | 'operator' | 'viewer';

export class OpenFgaStore {
  private opts: OpenFgaOptions;
  private client: OpenFgaClient | null = null;

  constructor(opts: OpenFgaOptions = loadOpenFgaOptions()) {
    this.opts = opts;
  }

  /** GUI hot-apply: replace the effective options (e.g. after Settings save). */
  update(partial: Partial<OpenFgaOptions>): void {
    this.opts = { ...this.opts, ...partial };
    this.client = null;
  }

  getOptions(): OpenFgaOptions {
    return { ...this.opts };
  }

  private getClient(): OpenFgaClient {
    if (this.client) return this.client;
    this.client = new OpenFgaClient(
      new ClientConfiguration({
        apiUrl: this.opts.endpoint,
        storeId: this.opts.storeId,
        authorizationModelId: this.opts.modelId,
      }),
    );
    return this.client;
  }

  /**
   * Ensure a store + authorization model exist (idempotent). Returns the
   * effective store/model IDs so the caller can persist them (GUI-first: the
   * Settings UI shows them). No-op when OpenFGA is disabled.
   */
  async provision(): Promise<{ storeId: string; modelId: string }> {
    if (!this.opts.enabled) return { storeId: this.opts.storeId ?? '', modelId: this.opts.modelId ?? '' };
    const client = this.getClient();

    // Store: reuse the configured storeId if present, else find/create by name.
    let storeId = this.opts.storeId;
    if (!storeId) {
      const existing = await client.listStores({ pageSize: 100 });
      const match = existing.stores?.find((s) => s.name === 'overlay-companion');
      if (match?.id) {
        storeId = match.id;
      } else {
        const created = await client.createStore({ name: 'overlay-companion' });
        storeId = created.id;
      }
      this.opts.storeId = storeId;
      this.client = null; // rebuild with the storeId
    }

    // Model: reuse the configured modelId if present, else write the model.
    let modelId = this.opts.modelId;
    if (!modelId) {
      const written = await this.getClient().writeAuthorizationModel(OPENFGA_MODEL as never, { storeId });
      modelId = written.authorization_model_id;
      this.opts.modelId = modelId;
      this.client = null;
    }

    return { storeId, modelId };
  }

  /** Write the owner tuple for a freshly created connection. No-op when disabled. */
  async writeOwner(userId: string, connectionId: string): Promise<void> {
    if (!this.opts.enabled) return;
    await this.getClient().writeTuples(
      [{ user: `user:${userId}`, relation: 'owner', object: `connection:${connectionId}` }],
      { storeId: this.opts.storeId },
    );
  }

  /** Delete every tuple touching a connection (on connection delete). No-op when disabled. */
  async deleteTuplesForConnection(connectionId: string): Promise<void> {
    if (!this.opts.enabled) return;
    // owner/operator/viewer tuples for this object are removed by wildcard user.
    await this.getClient().deleteTuples(
      [
        { user: 'user:*', relation: 'owner', object: `connection:${connectionId}` },
        { user: 'user:*', relation: 'operator', object: `connection:${connectionId}` },
        { user: 'user:*', relation: 'viewer', object: `connection:${connectionId}` },
      ],
      { storeId: this.opts.storeId },
    );
  }

  /**
   * Authorization decision for a user on a connection. Fail-closed when
   * enabled: an unreachable/erroring OpenFGA denies. When disabled, returns
   * true (owner-scoped behavior is the only gate).
   */
  async check(userId: string, relation: ConnectionRelation, connectionId: string): Promise<boolean> {
    if (!this.opts.enabled) return true;
    try {
      const result = await this.getClient().check(
        { user: `user:${userId}`, relation, object: `connection:${connectionId}` },
        { storeId: this.opts.storeId, authorizationModelId: this.opts.modelId },
      );
      return result.allowed === true;
    } catch (err) {
      console.warn('[WARN] OpenFGA check failed (deny):', (err as Error).message);
      return false;
    }
  }

  /**
   * The connection IDs a user may view, or null when OpenFGA is disabled
   * (caller keeps its owner-scoped query). Returns bare IDs without the
   * `connection:` prefix.
   */
  async listViewableConnectionIds(userId: string): Promise<string[] | null> {
    if (!this.opts.enabled) return null;
    try {
      const result = await this.getClient().listObjects(
        { user: `user:${userId}`, relation: 'viewer', type: 'connection' },
        { storeId: this.opts.storeId, authorizationModelId: this.opts.modelId },
      );
      return (result.objects ?? []).map((o) => o.replace(/^connection:/, ''));
    } catch (err) {
      console.warn('[WARN] OpenFGA listObjects failed (deny):', (err as Error).message);
      return [];
    }
  }

  /** Lightweight reachability probe for the health endpoint. */
  async ping(): Promise<boolean> {
    if (!this.opts.enabled) return false;
    try {
      await this.getClient().listStores({ pageSize: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
