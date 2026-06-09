import type { SchemaField, SchemaLayoutTab } from '../../types/schema';

export type SchemaFieldPathSegment =
  | { type: 'root'; index: number }
  | { type: 'children'; fieldId: string; index: number }
  | { type: 'tab'; fieldId: string; tabId: string; index: number };

export interface SchemaFieldWithPath {
  field: SchemaField;
  path: SchemaFieldPathSegment[];
  depth: number;
}

export function isLayoutField(field: Pick<SchemaField, 'kind' | 'semanticType'>) {
  return field.kind === 'group' || field.kind === 'multi-tab' || field.semanticType === 'layout';
}

export function normalizeLayoutTabs(field: SchemaField): SchemaLayoutTab[] {
  const rawTabs = (field.componentProps?.tabs ?? []) as unknown;
  const tabs: SchemaLayoutTab[] = [];
  if (Array.isArray(rawTabs)) {
    rawTabs.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : `tab_${index + 1}`;
      const label = typeof record.label === 'string' && record.label.trim()
        ? record.label.trim()
        : `Tab ${index + 1}`;
      const children = Array.isArray(record.children)
        ? (record.children as SchemaField[])
        : [];
      if (!tabs.some((tab) => tab.id === id)) {
        tabs.push({ id, label, children });
      }
    });
  }
  return tabs.length > 0
    ? tabs
    : [
        { id: 'tab_1', label: 'Tab 1', children: field.children ?? [] },
        { id: 'tab_2', label: 'Tab 2', children: [] },
      ];
}

export function withLayoutTabs(field: SchemaField, tabs: SchemaLayoutTab[]): SchemaField {
  return {
    ...field,
    componentProps: {
      ...(field.componentProps ?? {}),
      tabs,
    },
    children: undefined,
  };
}

export function getFieldChildren(field: SchemaField): SchemaField[] {
  if (field.kind === 'multi-tab') {
    return normalizeLayoutTabs(field).flatMap((tab) => tab.children ?? []);
  }
  return field.children ?? [];
}

export function flattenSchemaFields(fields: SchemaField[]): SchemaField[] {
  return walkSchemaFields(fields).map((item) => item.field);
}

export function walkSchemaFields(fields: SchemaField[]): SchemaFieldWithPath[] {
  const result: SchemaFieldWithPath[] = [];

  const walk = (items: SchemaField[], parentPath: SchemaFieldPathSegment[], depth: number) => {
    items.forEach((field, index) => {
      const path = [...parentPath, { type: 'root', index } as SchemaFieldPathSegment];
      result.push({ field, path, depth });
      if (field.kind === 'multi-tab') {
        normalizeLayoutTabs(field).forEach((tab) => {
          (tab.children ?? []).forEach((child, childIndex) => {
            walkField(child, [...path, { type: 'tab', fieldId: field.id, tabId: tab.id, index: childIndex }], depth + 1);
          });
        });
      } else {
        (field.children ?? []).forEach((child, childIndex) => {
          walkField(child, [...path, { type: 'children', fieldId: field.id, index: childIndex }], depth + 1);
        });
      }
    });
  };

  const walkField = (field: SchemaField, path: SchemaFieldPathSegment[], depth: number) => {
    result.push({ field, path, depth });
    if (field.kind === 'multi-tab') {
      normalizeLayoutTabs(field).forEach((tab) => {
        (tab.children ?? []).forEach((child, childIndex) => {
          walkField(child, [...path, { type: 'tab', fieldId: field.id, tabId: tab.id, index: childIndex }], depth + 1);
        });
      });
      return;
    }
    (field.children ?? []).forEach((child, childIndex) => {
      walkField(child, [...path, { type: 'children', fieldId: field.id, index: childIndex }], depth + 1);
    });
  };

  walk(fields, [], 0);
  return result;
}

export function findSchemaField(fields: SchemaField[], fieldId: string): SchemaField | null {
  return flattenSchemaFields(fields).find((field) => field.id === fieldId) ?? null;
}

export function mapSchemaFieldTree(
  fields: SchemaField[],
  mapper: (field: SchemaField) => SchemaField,
): SchemaField[] {
  return fields.map((field) => mapOneField(field, mapper));
}

function mapOneField(field: SchemaField, mapper: (field: SchemaField) => SchemaField): SchemaField {
  const withChildren =
    field.kind === 'multi-tab'
      ? withLayoutTabs(
          field,
          normalizeLayoutTabs(field).map((tab) => ({
            ...tab,
            children: mapSchemaFieldTree(tab.children ?? [], mapper),
          })),
        )
      : {
          ...field,
          children: field.children ? mapSchemaFieldTree(field.children, mapper) : field.children,
        };
  return mapper(withChildren);
}

export function normalizeSchemaFieldTree(
  fields: SchemaField[],
  normalizer: (field: SchemaField, allFields: SchemaField[]) => SchemaField,
): SchemaField[] {
  const allFields = flattenSchemaFields(fields);
  return mapSchemaFieldTree(fields, (field) => normalizer(field, allFields));
}

