// Schema Registry — namespaced type management with validation and traits

import { z } from 'zod';

export interface RegisteredType {
  typeId: string;
  semanticClass: string;
  schemaVersion: string;
  jsonSchema: Record<string, unknown>;
  traits: string[];
  display: { icon?: string; color?: string; label?: string };
  migration?: { from: string; transform: string };
}

export const RegisteredTypeSchema = z.object({
  typeId: z.string().regex(/^[a-z]+\.[a-z_]+$/),
  semanticClass: z.string(),
  schemaVersion: z.string(),
  jsonSchema: z.record(z.unknown()),
  traits: z.array(z.string()),
  display: z.object({
    icon: z.string().optional(),
    color: z.string().optional(),
    label: z.string().optional(),
  }),
  migration: z
    .object({
      from: z.string(),
      transform: z.string(),
    })
    .optional(),
});

import type postgres from 'postgres';
type Sql = ReturnType<typeof postgres>;

export class SchemaRegistry {
  private types = new Map<string, RegisteredType>();

  constructor(private sql?: Sql) {}

  async loadFromDb(): Promise<void> {
    if (!this.sql) return;
    const rows = await this.sql`SELECT * FROM type_registry`;
    for (const row of rows) {
      this.types.set(row.type_id as string, {
        typeId: row.type_id as string,
        semanticClass: row.semantic_class as string,
        schemaVersion: row.schema_version as string,
        jsonSchema: row.json_schema as Record<string, unknown>,
        traits: row.traits as string[],
        display: row.display as { icon?: string; color?: string; label?: string },
        migration: row.migration as { from: string; transform: string } | undefined,
      });
    }
  }

  async saveToDb(type: RegisteredType): Promise<void> {
    if (!this.sql) return;
    await this.sql`
      INSERT INTO type_registry (type_id, semantic_class, schema_version, json_schema, traits, display, migration)
      VALUES (${type.typeId}, ${type.semanticClass}, ${type.schemaVersion}, ${JSON.stringify(type.jsonSchema)}, ${type.traits}, ${JSON.stringify(type.display)}, ${type.migration ? JSON.stringify(type.migration) : null})
      ON CONFLICT (type_id) DO UPDATE SET
        semantic_class = EXCLUDED.semantic_class,
        schema_version = EXCLUDED.schema_version,
        json_schema = EXCLUDED.json_schema,
        traits = EXCLUDED.traits,
        display = EXCLUDED.display,
        migration = EXCLUDED.migration
    `;
  }

  register(type: RegisteredType): void {
    RegisteredTypeSchema.parse(type);
    this.types.set(type.typeId, type);
  }

  get(typeId: string): RegisteredType | undefined {
    return this.types.get(typeId);
  }

  has(typeId: string): boolean {
    return this.types.has(typeId);
  }

  list(prefix?: string): RegisteredType[] {
    const all = Array.from(this.types.values());
    if (prefix) return all.filter((t) => t.typeId.startsWith(prefix));
    return all;
  }

  listNamespaces(): string[] {
    const namespaces = new Set<string>();
    for (const typeId of this.types.keys()) {
      const ns = typeId.split('.')[0];
      if (ns) namespaces.add(ns);
    }
    return Array.from(namespaces).sort();
  }

  validate(
    typeId: string,
    data: unknown,
  ): { valid: boolean; errors?: string[] } {
    const type = this.types.get(typeId);
    if (!type) return { valid: false, errors: [`Unknown type: ${typeId}`] };

    // Validate against JSON schema using a lightweight check
    const schema = type.jsonSchema;
    const errors: string[] = [];

    if (schema.type === 'object' && schema.properties && typeof data === 'object' && data !== null) {
      const props = schema.properties as Record<string, { type?: string }>;
      const record = data as Record<string, unknown>;

      // Check required fields
      if (Array.isArray(schema.required)) {
        for (const req of schema.required as string[]) {
          if (!(req in record)) {
            errors.push(`Missing required field: ${req}`);
          }
        }
      }

      // Check field types
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in record && propSchema.type) {
          const value = record[key];
          const expectedType = propSchema.type;
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (expectedType !== actualType && value !== null && value !== undefined) {
            errors.push(`Field "${key}" expected ${expectedType}, got ${actualType}`);
          }
        }
      }
    } else if (schema.type === 'object' && typeof data !== 'object') {
      errors.push(`Expected object, got ${typeof data}`);
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  hasTrait(typeId: string, trait: string): boolean {
    const type = this.types.get(typeId);
    return type?.traits.includes(trait) ?? false;
  }

  getByTrait(trait: string): RegisteredType[] {
    return Array.from(this.types.values()).filter((t) =>
      t.traits.includes(trait),
    );
  }

  getBySemanticClass(semanticClass: string): RegisteredType[] {
    return Array.from(this.types.values()).filter(
      (t) => t.semanticClass === semanticClass,
    );
  }

  registerPack(
    packName: string,
    types: Record<string, Omit<RegisteredType, 'typeId'>>,
  ): void {
    for (const [suffix, typeDef] of Object.entries(types)) {
      const typeId = `${packName}.${suffix}`;
      this.register({ ...typeDef, typeId });
    }
  }
}
