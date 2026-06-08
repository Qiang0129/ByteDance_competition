import type { SchemaField } from '../../types/schema';
import { resolveSemanticType } from './schemaCompiler';

export interface AnswerDisplayEntry {
  key: string;
  label: string;
  value: unknown;
  displayValue: string;
  field?: SchemaField;
}

export function toAnswerDisplayEntries(
  answer: Record<string, unknown> | undefined,
  fields: SchemaField[] | undefined,
): AnswerDisplayEntry[] {
  const source = answer ?? {};
  return Object.entries(source).map(([key, value]) => {
    const field = fields?.find((item) => item.fieldName === key);
    return {
      key,
      label: field?.label || key,
      value,
      displayValue: formatAnswerDisplayValue(value, field),
      field,
    };
  });
}

export function formatAnswerDisplayValue(value: unknown, field?: SchemaField): string {
  if (value == null) return '—';
  const semanticType = field ? resolveSemanticType(field) : undefined;
  if (semanticType === 'single_choice') {
    return resolveOptionLabel(value, field) ?? formatPlainValue(value);
  }
  if (semanticType === 'multi_choice' || semanticType === 'tags') {
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((item) => resolveOptionLabel(item, field) ?? formatPlainValue(item))
      .join('、');
  }
  if (semanticType === 'file') {
    return formatFileValue(value);
  }
  return formatPlainValue(value);
}

function resolveOptionLabel(value: unknown, field?: SchemaField): string | undefined {
  if (!field?.options?.length) return undefined;
  const text = String(value);
  return field.options.find((option) => option.value === text)?.label;
}

function formatPlainValue(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map((entry) => formatPlainValue(entry)).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatFileValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value || '—';
  if (!Array.isArray(value)) return formatPlainValue(value);
  if (value.length === 0) return '—';
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return formatPlainValue(item);
      const name = (item as Record<string, unknown>).name;
      return typeof name === 'string' && name.trim() ? name.trim() : formatPlainValue(item);
    })
    .join('、');
}
