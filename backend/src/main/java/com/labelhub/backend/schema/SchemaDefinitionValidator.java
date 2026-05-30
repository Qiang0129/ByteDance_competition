package com.labelhub.backend.schema;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.springframework.stereotype.Component;

@Component
public class SchemaDefinitionValidator {

  private static final Pattern FIELD_NAME = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*$");
  private static final Set<String> ALLOWED_KINDS = Set.of(
      "text-single",
      "text-multi",
      "single-choice",
      "multi-choice",
      "tags",
      "rich-text",
      "file-upload",
      "json-editor",
      "llm-trigger",
      "show-item",
      "group",
      "multi-tab");
  private static final Set<String> CHOICE_KINDS = Set.of("single-choice", "multi-choice", "tags");
  private static final Set<String> ALLOWED_SEMANTIC_TYPES = Set.of(
      "text",
      "single_choice",
      "multi_choice",
      "tags",
      "json",
      "file",
      "llm",
      "display",
      "layout");
  private static final Set<String> SUBMITTABLE_KINDS = Set.of(
      "text-single",
      "text-multi",
      "single-choice",
      "multi-choice",
      "tags",
      "rich-text",
      "file-upload",
      "json-editor",
      "llm-trigger");
  private static final Set<String> ALLOWED_VALIDATORS =
      Set.of("regex", "noEmoji", "jsonObject", "lengthBetween");
  private static final Set<String> ALLOWED_REACTION_OPERATORS =
      Set.of("eq", "ne", "empty", "notEmpty", "includes");
  private static final Set<String> ALLOWED_REACTION_ACTIONS =
      Set.of("visible", "hidden", "required", "optional", "visibleRequired");

  public SchemaValidationResponse validate(JsonNode fields) {
    List<SchemaDiagnosticResponse> errors = new ArrayList<>();
    List<SchemaDiagnosticResponse> warnings = new ArrayList<>();
    if (fields == null || !fields.isArray() || fields.isEmpty()) {
      errors.add(error("SCHEMA_FIELDS_REQUIRED", "至少需要配置一个字段。", null));
      return new SchemaValidationResponse(false, errors, warnings);
    }

    Map<String, Integer> nameCounts = new HashMap<>();
    Set<String> fieldNames = new HashSet<>();
    boolean hasSubmittable = false;

    for (JsonNode field : fields) {
      String kind = text(field, "kind");
      String semanticType = fallback(text(field, "semanticType"), inferSemanticType(kind));
      String fieldName = text(field, "fieldName");
      String label = fallback(text(field, "label"), fallback(fieldName, "字段"));

      if (!ALLOWED_KINDS.contains(kind)) {
        errors.add(error("INVALID_FIELD_KIND", label + " 的物料类型不受支持。", fieldName));
      }
      if (!ALLOWED_SEMANTIC_TYPES.contains(semanticType)) {
        errors.add(error("INVALID_SEMANTIC_TYPE", label + " 的语义类型不受支持。", fieldName));
      }
      if (SUBMITTABLE_KINDS.contains(kind)) {
        hasSubmittable = true;
      }
      if (fieldName == null || !FIELD_NAME.matcher(fieldName).matches()) {
        errors.add(error(
            "INVALID_FIELD_NAME",
            label + " 的字段名必须是英文字母或下划线开头,且只能包含字母、数字、下划线。",
            fieldName));
      } else {
        fieldNames.add(fieldName);
        nameCounts.put(fieldName, nameCounts.getOrDefault(fieldName, 0) + 1);
      }
      if (text(field, "label") == null) {
        errors.add(error("FIELD_LABEL_REQUIRED", fieldName + " 缺少显示标签。", fieldName));
      }
      if (CHOICE_KINDS.contains(kind)) {
        validateOptions(field, errors, label, fieldName);
      }
      if ("show-item".equals(kind)
          && text(field, "sourcePath") == null
          && text(field, "showText") == null) {
        errors.add(error(
            "SHOW_ITEM_SOURCE_REQUIRED",
            label + " 必须绑定 raw_payload 字段路径或填写静态展示内容。",
            fieldName));
      }
      int maxLength = field.path("maxLength").asInt(0);
      if (field.has("maxLength") && maxLength <= 0) {
        errors.add(error("INVALID_MAX_LENGTH", label + " 的最大长度必须大于 0。", fieldName));
      }
      validateValidators(field, errors, label, fieldName);
    }

    nameCounts.forEach((fieldName, count) -> {
      if (count > 1) {
        errors.add(error("DUPLICATE_FIELD_NAME", "字段名 " + fieldName + " 重复,会导致答案覆盖。", fieldName));
      }
    });
    for (JsonNode field : fields) {
      validateReactions(field, fieldNames, errors, warnings);
    }
    if (!hasSubmittable) {
      warnings.add(warning("NO_SUBMITTABLE_FIELD", "当前模板没有可提交字段,Labeler 只能查看题目数据。", null));
    }
    return new SchemaValidationResponse(errors.isEmpty(), errors, warnings);
  }

  private void validateOptions(
      JsonNode field,
      List<SchemaDiagnosticResponse> errors,
      String label,
      String fieldName) {
    JsonNode options = field.path("options");
    if (!options.isArray() || options.isEmpty()) {
      errors.add(error("CHOICE_OPTIONS_REQUIRED", label + " 至少需要配置一个选项。", fieldName));
      return;
    }
    Set<String> values = new HashSet<>();
    int index = 1;
    for (JsonNode option : options) {
      String value = text(option, "value");
      String optionLabel = text(option, "label");
      if (value == null || optionLabel == null) {
        errors.add(error("INVALID_CHOICE_OPTION", label + " 的第 " + index + " 个选项缺少 value 或 label。", fieldName));
      }
      if (value != null && !values.add(value)) {
        errors.add(error("DUPLICATE_CHOICE_VALUE", label + " 的选项值 " + value + " 重复。", fieldName));
      }
      index++;
    }
  }

  private void validateValidators(
      JsonNode field,
      List<SchemaDiagnosticResponse> errors,
      String label,
      String fieldName) {
    JsonNode validators = field.path("validators");
    if (validators.isArray()) {
      for (JsonNode validator : validators) {
        String type = text(validator, "type");
        if (!ALLOWED_VALIDATORS.contains(type)) {
          errors.add(error("INVALID_VALIDATOR", label + " 使用了不在白名单内的校验规则。", fieldName));
          continue;
        }
        if ("regex".equals(type)) {
          validateRegex(text(validator, "pattern"), errors, label, fieldName);
        }
        if ("lengthBetween".equals(type)
            && validator.path("min").asInt(0) > validator.path("max").asInt(0)) {
          errors.add(error("INVALID_LENGTH_RANGE", label + " 的长度区间配置不合法。", fieldName));
        }
      }
    }
    String legacyRegex = field.path("validations").path("regex").asText("");
    if (!legacyRegex.isBlank()) {
      validateRegex(legacyRegex, errors, label, fieldName);
    }
    String customFn = field.path("validations").path("customFn").asText("");
    if (!customFn.isBlank()
        && !Set.of("noEmoji(value)", "isJsonObject(value)", "lengthBetween(value, 4, 35)").contains(customFn)) {
      errors.add(error("INVALID_VALIDATOR", label + " 使用了不在白名单内的自定义函数。", fieldName));
    }
  }

  private void validateRegex(
      String pattern,
      List<SchemaDiagnosticResponse> errors,
      String label,
      String fieldName) {
    if (pattern == null || pattern.isBlank()) {
      errors.add(error("INVALID_REGEX", label + " 的正则表达式不能为空。", fieldName));
      return;
    }
    try {
      Pattern.compile(pattern);
    } catch (PatternSyntaxException exception) {
      errors.add(error("INVALID_REGEX", label + " 的正则表达式不合法。", fieldName));
    }
  }

  private void validateReactions(
      JsonNode field,
      Set<String> fieldNames,
      List<SchemaDiagnosticResponse> errors,
      List<SchemaDiagnosticResponse> warnings) {
    JsonNode reactions = field.path("reactions");
    if (!reactions.isArray()) {
      return;
    }
    String fieldName = text(field, "fieldName");
    int index = 1;
    for (JsonNode reaction : reactions) {
      String sourceField = text(reaction, "sourceField");
      String targetField = text(reaction, "targetField");
      String operator = text(reaction, "operator");
      String action = text(reaction, "action");
      String prefix = fallback(fieldName, "字段") + " 的第 " + index + " 条联动规则";
      if (!ALLOWED_REACTION_OPERATORS.contains(operator)) {
        errors.add(error("INVALID_REACTION_OPERATOR", prefix + " 使用了不支持的条件操作符。", fieldName));
      }
      if (!ALLOWED_REACTION_ACTIONS.contains(action)) {
        errors.add(error("INVALID_REACTION_ACTION", prefix + " 使用了不支持的联动动作。", fieldName));
      }
      if (!fieldNames.contains(sourceField)) {
        errors.add(error("REACTION_SOURCE_NOT_FOUND", prefix + " 引用的来源字段 " + sourceField + " 不存在。", fieldName));
      }
      if (!fieldNames.contains(targetField)) {
        errors.add(error("REACTION_TARGET_NOT_FOUND", prefix + " 引用的目标字段 " + targetField + " 不存在。", fieldName));
      }
      if (sourceField != null && sourceField.equals(targetField)) {
        warnings.add(warning("REACTION_SELF_REFERENCE", prefix + " 自引用,请确认这是否符合预期。", fieldName));
      }
      index++;
    }
  }

  private SchemaDiagnosticResponse error(String code, String message, String fieldName) {
    return new SchemaDiagnosticResponse("error", code, message, fieldName);
  }

  private SchemaDiagnosticResponse warning(String code, String message, String fieldName) {
    return new SchemaDiagnosticResponse("warning", code, message, fieldName);
  }

  private String text(JsonNode node, String field) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return null;
    }
    String value = node.get(field).isTextual()
        ? node.get(field).asText()
        : node.get(field).toString();
    value = value == null ? null : value.trim();
    return value == null || value.isBlank() ? null : value;
  }

  private String fallback(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private String inferSemanticType(String kind) {
    if (kind == null) {
      return "text";
    }
    return switch (kind) {
      case "single-choice" -> "single_choice";
      case "multi-choice" -> "multi_choice";
      case "tags" -> "tags";
      case "json-editor" -> "json";
      case "file-upload" -> "file";
      case "llm-trigger" -> "llm";
      case "show-item" -> "display";
      case "group", "multi-tab" -> "layout";
      default -> "text";
    };
  }
}
