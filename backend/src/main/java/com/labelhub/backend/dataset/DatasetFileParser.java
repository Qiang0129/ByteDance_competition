package com.labelhub.backend.dataset;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.DecimalNode;
import com.fasterxml.jackson.databind.node.IntNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.labelhub.backend.auth.ApiException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipInputStream;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.SAXException;

@Component
public class DatasetFileParser {

  private final ObjectMapper objectMapper;

  public DatasetFileParser(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  public List<JsonNode> parse(String filename, byte[] bytes) {
    String ext = extension(filename);
    try {
      return switch (ext) {
        case "json" -> parseJson(bytes);
        case "jsonl", "ndjson" -> parseJsonLines(bytes);
        case "csv" -> parseCsv(bytes);
        case "xlsx" -> parseXlsx(bytes);
        default -> throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "UNSUPPORTED_DATASET_FILE",
            "only json, jsonl, csv and basic xlsx files are supported");
      };
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DATASET_JSON", "dataset json is invalid");
    } catch (IOException | ParserConfigurationException | SAXException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DATASET_FILE", "dataset file cannot be parsed");
    }
  }

  private List<JsonNode> parseJson(byte[] bytes) throws IOException {
    JsonNode root = objectMapper.readTree(bytes);
    List<JsonNode> rows = new ArrayList<>();
    if (root == null || root.isNull()) {
      return rows;
    }
    if (root.isArray()) {
      root.forEach(node -> rows.add(normalizeObjectNode(node)));
      return rows;
    }
    JsonNode nestedItems = root.get("items");
    if (nestedItems != null && nestedItems.isArray()) {
      nestedItems.forEach(node -> rows.add(normalizeObjectNode(node)));
      return rows;
    }
    rows.add(normalizeObjectNode(root));
    return rows;
  }

  private List<JsonNode> parseJsonLines(byte[] bytes) throws IOException {
    String text = new String(bytes, StandardCharsets.UTF_8).replace("\uFEFF", "");
    List<JsonNode> rows = new ArrayList<>();
    String[] lines = text.split("\\R");
    for (String line : lines) {
      if (line == null || line.isBlank()) {
        continue;
      }
      rows.add(normalizeObjectNode(objectMapper.readTree(line)));
    }
    return rows;
  }

  private List<JsonNode> parseCsv(byte[] bytes) {
    String text = new String(bytes, StandardCharsets.UTF_8).replace("\uFEFF", "");
    return rowsToObjects(parseDelimitedRows(text));
  }

  private List<JsonNode> parseXlsx(byte[] bytes)
      throws IOException, ParserConfigurationException, SAXException {
    Map<String, byte[]> entries = new HashMap<>();
    try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
      var entry = zip.getNextEntry();
      while (entry != null) {
        if (!entry.isDirectory()) {
          String name = entry.getName();
          if ("xl/sharedStrings.xml".equals(name) || name.startsWith("xl/worksheets/sheet")) {
            entries.put(name, zip.readAllBytes());
          }
        }
        entry = zip.getNextEntry();
      }
    }

    String sheetEntry = entries.keySet().stream()
        .filter(name -> name.startsWith("xl/worksheets/sheet") && name.endsWith(".xml"))
        .sorted(Comparator.naturalOrder())
        .findFirst()
        .orElseThrow(() -> new ApiException(
            HttpStatus.BAD_REQUEST,
            "INVALID_XLSX_DATASET",
            "xlsx file does not contain a worksheet"));

    List<String> sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml"));
    List<List<String>> rows = parseSheet(entries.get(sheetEntry), sharedStrings);
    return rowsToObjects(rows);
  }

  private List<String> parseSharedStrings(byte[] bytes)
      throws ParserConfigurationException, IOException, SAXException {
    if (bytes == null || bytes.length == 0) {
      return List.of();
    }
    var document = parseXml(bytes);
    var nodes = document.getElementsByTagName("si");
    List<String> values = new ArrayList<>();
    for (int i = 0; i < nodes.getLength(); i++) {
      values.add(nodes.item(i).getTextContent());
    }
    return values;
  }

  private List<List<String>> parseSheet(byte[] bytes, List<String> sharedStrings)
      throws ParserConfigurationException, IOException, SAXException {
    var document = parseXml(bytes);
    var rowNodes = document.getElementsByTagName("row");
    List<List<String>> rows = new ArrayList<>();
    for (int rowIdx = 0; rowIdx < rowNodes.getLength(); rowIdx++) {
      Node rowNode = rowNodes.item(rowIdx);
      List<String> row = new ArrayList<>();
      var children = rowNode.getChildNodes();
      int fallbackCol = 0;
      for (int childIdx = 0; childIdx < children.getLength(); childIdx++) {
        Node child = children.item(childIdx);
        if (!(child instanceof Element cell) || !"c".equals(cell.getTagName())) {
          continue;
        }
        int colIndex = resolveColumnIndex(cell.getAttribute("r"), fallbackCol);
        while (row.size() <= colIndex) {
          row.add("");
        }
        row.set(colIndex, readCellValue(cell, sharedStrings));
        fallbackCol = colIndex + 1;
      }
      if (row.stream().anyMatch(value -> value != null && !value.isBlank())) {
        rows.add(row);
      }
    }
    return rows;
  }

  private String readCellValue(Element cell, List<String> sharedStrings) {
    String type = cell.getAttribute("t");
    if ("inlineStr".equals(type)) {
      var inline = cell.getElementsByTagName("is");
      return inline.getLength() == 0 ? "" : inline.item(0).getTextContent();
    }

    var valueNodes = cell.getElementsByTagName("v");
    String raw = valueNodes.getLength() == 0 ? "" : valueNodes.item(0).getTextContent();
    if ("s".equals(type)) {
      try {
        int index = Integer.parseInt(raw);
        return index >= 0 && index < sharedStrings.size() ? sharedStrings.get(index) : "";
      } catch (NumberFormatException exception) {
        return "";
      }
    }
    if ("b".equals(type)) {
      return "1".equals(raw) ? "true" : "false";
    }
    return raw == null ? "" : raw;
  }

  private org.w3c.dom.Document parseXml(byte[] bytes)
      throws ParserConfigurationException, IOException, SAXException {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    factory.setExpandEntityReferences(false);
    return factory.newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
  }

  private List<JsonNode> rowsToObjects(List<List<String>> rows) {
    int headerIndex = -1;
    for (int i = 0; i < rows.size(); i++) {
      if (rows.get(i).stream().anyMatch(value -> value != null && !value.isBlank())) {
        headerIndex = i;
        break;
      }
    }
    if (headerIndex < 0) {
      return List.of();
    }

    List<String> headers = rows.get(headerIndex).stream()
        .map(value -> value == null ? "" : value.trim())
        .toList();
    List<JsonNode> out = new ArrayList<>();
    for (int i = headerIndex + 1; i < rows.size(); i++) {
      List<String> row = rows.get(i);
      if (row.stream().allMatch(value -> value == null || value.isBlank())) {
        continue;
      }
      ObjectNode object = objectMapper.createObjectNode();
      for (int col = 0; col < headers.size(); col++) {
        String header = headers.get(col);
        if (header.isBlank()) {
          continue;
        }
        String value = col < row.size() && row.get(col) != null ? row.get(col).trim() : "";
        object.set(header, scalarNode(value));
      }
      out.add(object);
    }
    return out;
  }

  private List<List<String>> parseDelimitedRows(String text) {
    List<List<String>> rows = new ArrayList<>();
    List<String> row = new ArrayList<>();
    StringBuilder field = new StringBuilder();
    boolean inQuotes = false;
    for (int i = 0; i < text.length(); i++) {
      char ch = text.charAt(i);
      if (inQuotes) {
        if (ch == '"' && i + 1 < text.length() && text.charAt(i + 1) == '"') {
          field.append('"');
          i++;
        } else if (ch == '"') {
          inQuotes = false;
        } else {
          field.append(ch);
        }
        continue;
      }
      if (ch == '"') {
        inQuotes = true;
      } else if (ch == ',') {
        row.add(field.toString());
        field.setLength(0);
      } else if (ch == '\n' || ch == '\r') {
        row.add(field.toString());
        field.setLength(0);
        rows.add(row);
        row = new ArrayList<>();
        if (ch == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') {
          i++;
        }
      } else {
        field.append(ch);
      }
    }
    row.add(field.toString());
    rows.add(row);
    return rows;
  }

  private JsonNode normalizeObjectNode(JsonNode node) {
    if (node != null && node.isObject()) {
      return node.deepCopy();
    }
    ObjectNode wrapper = objectMapper.createObjectNode();
    wrapper.set("value", node == null ? JsonNodeFactory.instance.nullNode() : node);
    return wrapper;
  }

  private JsonNode scalarNode(String value) {
    if (value == null || value.isBlank()) {
      return TextNode.valueOf("");
    }
    String normalized = value.trim();
    if ("true".equalsIgnoreCase(normalized) || "false".equalsIgnoreCase(normalized)) {
      return BooleanNode.valueOf(Boolean.parseBoolean(normalized));
    }
    if (normalized.startsWith("[") || normalized.startsWith("{")) {
      try {
        return objectMapper.readTree(normalized);
      } catch (JsonProcessingException ignored) {
        // Keep the original text when a spreadsheet cell only looks like JSON.
      }
    }
    if (normalized.matches("^-?\\d+$")) {
      try {
        return IntNode.valueOf(Integer.parseInt(normalized));
      } catch (NumberFormatException ignored) {
        // Large integers fall back to decimal/text below.
      }
    }
    if (normalized.matches("^-?\\d+\\.\\d+$")) {
      try {
        return DecimalNode.valueOf(new BigDecimal(normalized));
      } catch (NumberFormatException ignored) {
        // Fall through to text.
      }
    }
    return TextNode.valueOf(value);
  }

  private int resolveColumnIndex(String cellRef, int fallback) {
    if (cellRef == null || cellRef.isBlank()) {
      return fallback;
    }
    int index = 0;
    int chars = 0;
    for (char ch : cellRef.toCharArray()) {
      if (!Character.isLetter(ch)) {
        break;
      }
      index = index * 26 + (Character.toUpperCase(ch) - 'A' + 1);
      chars++;
    }
    return chars == 0 ? fallback : index - 1;
  }

  private String extension(String filename) {
    if (filename == null) {
      return "";
    }
    int dot = filename.lastIndexOf('.');
    return dot < 0 ? "" : filename.substring(dot + 1).toLowerCase(Locale.ROOT);
  }
}
