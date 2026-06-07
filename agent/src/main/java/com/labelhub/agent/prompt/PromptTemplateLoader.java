package com.labelhub.agent.prompt;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class PromptTemplateLoader {

  private static final Logger log = LoggerFactory.getLogger(PromptTemplateLoader.class);
  private static final String DEFAULT_PROMPTS_DIR = "agent/prompts";

  private final String promptsDir;

  public PromptTemplateLoader(@Value("${labelhub.prompts.dir:" + DEFAULT_PROMPTS_DIR + "}") String promptsDir) {
    this.promptsDir = promptsDir;
  }

  public String loadOrDefault(String fileName, String fallback) {
    Path path = resolveTemplatePath(fileName);
    if (path != null && Files.isRegularFile(path)) {
      try {
        String content = Files.readString(path, StandardCharsets.UTF_8);
        if (!content.isBlank()) {
          return content.strip();
        }
      } catch (IOException exception) {
        log.warn("Failed to read prompt template {}, using built-in fallback", path, exception);
      }
    }
    return fallback;
  }

  private Path resolveTemplatePath(String fileName) {
    String configuredDir = promptsDir == null || promptsDir.isBlank() ? DEFAULT_PROMPTS_DIR : promptsDir.trim();
    Path configured = Paths.get(configuredDir);
    if (configured.isAbsolute()) {
      return configured.resolve(fileName).normalize();
    }
    Path current = Paths.get("").toAbsolutePath().normalize();
    Path firstCandidate = null;
    for (Path base = current; base != null; base = base.getParent()) {
      Path candidate = base.resolve(configured).resolve(fileName).normalize();
      if (firstCandidate == null) {
        firstCandidate = candidate;
      }
      if (Files.isRegularFile(candidate)) {
        return candidate;
      }
    }
    return firstCandidate;
  }
}
