import { useEffect, useMemo, useRef } from 'react';
import { Button, Space, Tabs } from 'antd';
import { createForm, onFormValuesChange } from '@formily/core';
import { createSchemaField, FormProvider } from '@formily/react';

import type { SchemaField } from '../../types/schema';
import type { SchemaTab } from '../../types/schema';
import { compileToFormilySchema, normalizeSchemaTabs, resolveFieldTabId, resolveRuntimeRules } from './schemaCompiler';
import { formilyAntd6Components } from './formilyAntd6';

const SchemaFieldRenderer = createSchemaField({
  components: formilyAntd6Components,
});

export interface LabelHubFormRendererProps {
  schema: SchemaField[];
  tabs?: SchemaTab[];
  rawPayload?: Record<string, unknown>;
  value?: Record<string, unknown>;
  readonly?: boolean;
  submitText?: string;
  onChange?: (value: Record<string, unknown>) => void;
  onSubmit?: (value: Record<string, unknown>) => void | Promise<void>;
}

export function LabelHubFormRenderer({
  schema,
  tabs,
  rawPayload,
  value,
  readonly,
  submitText = '提交',
  onChange,
  onSubmit,
}: LabelHubFormRendererProps) {
  const onChangeRef = useRef(onChange);
  const suppressChangeRef = useRef(false);
  onChangeRef.current = onChange;

  const form = useMemo(
    () =>
      createForm({
        values: value ?? {},
        effects() {
          onFormValuesChange((currentForm) => {
            if (suppressChangeRef.current) return;
            onChangeRef.current?.({ ...(currentForm.values as Record<string, unknown>) });
          });
        },
      }),
    // Formily form 实例需要稳定,字段结构变化通过 schema 重新渲染承载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    suppressChangeRef.current = true;
    form.setValues(value ?? {}, 'overwrite');
    queueMicrotask(() => {
      suppressChangeRef.current = false;
    });
  }, [form, value]);

  const formilySchema = useMemo(
    () =>
      compileToFormilySchema(schema, {
        rawPayload,
        values: value ?? {},
        readonly,
      }),
    [schema, rawPayload, value, readonly],
  );
  const schemaTabs = useMemo(() => normalizeSchemaTabs(tabs), [tabs]);
  const useTabbedRenderer = schemaTabs.length > 1;
  const tabbedSchemas = useMemo(
    () =>
      Object.fromEntries(
        schemaTabs.map((tab) => [
          tab.id,
          compileToFormilySchema(schema, {
            rawPayload,
            values: value ?? {},
            readonly,
            fieldFilter: (field) => resolveFieldTabId(field, schemaTabs) === tab.id,
          }),
        ]),
      ) as Record<string, unknown>,
    [schema, schemaTabs, rawPayload, value, readonly],
  );
  const runtimeRuleKey = useMemo(
    () => JSON.stringify(resolveRuntimeRules(schema, value ?? {})),
    [schema, value],
  );

  return (
    <FormProvider form={form}>
      <div className="lh-formily-renderer">
        {useTabbedRenderer ? (
          <Tabs
            className="lh-formily-tabs"
            items={schemaTabs.map((tab) => ({
              key: tab.id,
              label: tab.label,
              children: (
                <SchemaFieldRenderer
                  key={`${runtimeRuleKey}-${tab.id}`}
                  schema={tabbedSchemas[tab.id] as never}
                />
              ),
            }))}
          />
        ) : (
          <SchemaFieldRenderer key={runtimeRuleKey} schema={formilySchema as never} />
        )}
        {onSubmit && (
          <Space className="lh-formily-actions">
            <Button
              type="primary"
              disabled={readonly}
              onClick={() => void onSubmit({ ...(form.values as Record<string, unknown>) })}
            >
              {readonly ? '已锁定' : submitText}
            </Button>
          </Space>
        )}
      </div>
    </FormProvider>
  );
}
