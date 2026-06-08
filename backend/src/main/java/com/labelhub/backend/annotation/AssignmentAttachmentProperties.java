package com.labelhub.backend.annotation;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "labelhub.attachments")
public class AssignmentAttachmentProperties {

  private String storageDir = "data/attachments";

  public String getStorageDir() {
    return storageDir;
  }

  public void setStorageDir(String storageDir) {
    this.storageDir = storageDir;
  }
}
