import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Tabs } from 'antd';
import { createForm, onFormValuesChange } from '@formily/core';
import { createSchemaField, FormProvider } from '@formily/react';

import type { SchemaField } from '../../types/schema';
import type { SchemaTab } from '../../types/schema';
import {
  compileToFormilySchema,
  getValueByPath,
  normalizeSchemaTabs,
  resolveFieldTabId,
  resolveRuntimeRules,
} from './schemaCompiler';
import { formilyAntd6Components } from './formilyAntd6';
import {
  EMPTY_LLM_TRIGGER_STATE,
  LlmTriggerStateContext,
  type LlmTriggerStateUpdater,
  type LlmTriggerUiState,
} from './llmTriggerState';

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
  assignmentId?: string;
  previewMode?: boolean;
  onChange?: (value: Record<string, unknown>) => void;
  onSubmit?: (value: Record<string, unknown>) => void | Promise<void>;
}

export function LabelHubFormRenderer({
  schema,
  tabs,
  rawPayload,
  value,
  readonly,
  assignmentId,
  previewMode,
  submitText = '提交',
  onChange,
  onSubmit,
}: LabelHubFormRendererProps) {
  const onChangeRef = useRef(onChange);
  const suppressChangeRef = useRef(false);
  const [llmTriggerStates, setLlmTriggerStates] = useState<Record<string, LlmTriggerUiState>>({});
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

  const applyLlmResults = useCallback(
    (nextValuesPatch: Record<string, unknown>) => {
      suppressChangeRef.current = true;
      form.setValues(nextValuesPatch, 'merge');
      const nextValues = {
        ...(form.values as Record<string, unknown>),
        ...nextValuesPatch,
      };
      onChangeRef.current?.(nextValues);
      queueMicrotask(() => {
        suppressChangeRef.current = false;
      });
    },
    [form],
  );

  const applyLlmResult = useCallback(
    (fieldName: string, nextValue: unknown) => {
      applyLlmResults({ [fieldName]: nextValue });
    },
    [applyLlmResults],
  );

  const schemaTabs = useMemo(() => normalizeSchemaTabs(tabs), [tabs]);
  const schemaRenderKey = useMemo(
    () => buildSchemaRenderKey(schema, schemaTabs, rawPayload),
    [schema, schemaTabs, rawPayload],
  );
  const llmStateScopeKey = useMemo(
    () => JSON.stringify({ assignmentId: assignmentId ?? '', schemaRenderKey }),
    [assignmentId, schemaRenderKey],
  );

  useEffect(() => {
    setLlmTriggerStates({});
  }, [llmStateScopeKey]);

  const updateLlmTriggerState = useCallback(
    (fieldName: string, updater: LlmTriggerStateUpdater) => {
      setLlmTriggerStates((previous) => {
        const current = previous[fieldName] ?? EMPTY_LLM_TRIGGER_STATE;
        const next = typeof updater === 'function'
          ? updater(current)
          : { ...current, ...updater };
        return { ...previous, [fieldName]: next };
      });
    },
    [],
  );
  const llmTriggerContextValue = useMemo(
    () => ({
      states: llmTriggerStates,
      updateState: updateLlmTriggerState,
    }),
    [llmTriggerStates, updateLlmTriggerState],
  );

  const formilySchema = useMemo(
    () =>
      compileToFormilySchema(schema, {
        rawPayload,
        values: value ?? {},
        readonly,
        assignmentId,
        previewMode,
        allFields: schema,
        onApplyLlmResult: applyLlmResult,
        onApplyLlmResults: applyLlmResults,
        llmTriggerStates,
        onUpdateLlmTriggerState: updateLlmTriggerState,
      }),
    [
      schema,
      rawPayload,
      value,
      readonly,
      assignmentId,
      previewMode,
      applyLlmResult,
      applyLlmResults,
      llmTriggerStates,
      updateLlmTriggerState,
    ],
  );
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
            assignmentId,
            previewMode,
            allFields: schema,
            onApplyLlmResult: applyLlmResult,
            onApplyLlmResults: applyLlmResults,
            llmTriggerStates,
            onUpdateLlmTriggerState: updateLlmTriggerState,
            fieldFilter: (field) => resolveFieldTabId(field, schemaTabs) === tab.id,
          }),
        ]),
      ) as Record<string, unknown>,
    [
      schema,
      schemaTabs,
      rawPayload,
      value,
      readonly,
      assignmentId,
      previewMode,
      applyLlmResult,
      applyLlmResults,
      llmTriggerStates,
      updateLlmTriggerState,
    ],
  );
  const runtimeRuleKey = useMemo(
    () => JSON.stringify(resolveRuntimeRules(schema, value ?? {})),
    [schema, value],
  );

  return (
    <FormProvider form={form}>
      <LlmTriggerStateContext.Provider value={llmTriggerContextValue}>
        <div className="lh-formily-renderer">
          {useTabbedRenderer ? (
            <Tabs
              className="lh-formily-tabs"
              items={schemaTabs.map((tab) => ({
                key: tab.id,
                label: tab.label,
                children: (
                  <SchemaFieldRenderer
                    key={`${schemaRenderKey}-${runtimeRuleKey}-${tab.id}`}
                    schema={tabbedSchemas[tab.id] as never}
                  />
                ),
              }))}
            />
          ) : (
            <SchemaFieldRenderer
              key={`${schemaRenderKey}-${runtimeRuleKey}`}
              schema={formilySchema as never}
            />
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
      </LlmTriggerStateContext.Provider>
    </FormProvider>
  );
}

function buildSchemaRenderKey(
  fields: SchemaField[],
  tabs: SchemaTab[],
  rawPayload?: Record<string, unknown>,
) {
  return JSON.stringify({
    tabs: tabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
    })),
    fields: fields.map((field) => ({
      id: field.id,
      fieldName: field.fieldName,
      kind: field.kind,
      semanticType: field.semanticType,
      label: field.label,
      required: field.required,
      placeholder: field.placeholder,
      maxLength: field.maxLength,
      options: (field.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
      })),
      sourcePath: field.sourcePath,
      sourceValue: field.sourcePath ? getValueByPath(rawPayload, field.sourcePath) : undefined,
      showText: field.showText,
      helpText: field.helpText,
      defaultValue: field.defaultValue,
      componentProps: field.componentProps,
      validators: field.validators,
      reactions: field.reactions,
      layout: field.layout,
    })),
  });
}
