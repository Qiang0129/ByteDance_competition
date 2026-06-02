package com.labelhub.backend.export;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "labelhub.export")
public class ExportProperties {

  private String storageDir = "data/exports";

  public String getStorageDir() {
    return storageDir;
  }

  public void setStorageDir(String storageDir) {
    this.storageDir = storageDir;
  }
}
