package com.labelhub.backend.dataset;

import java.util.List;

public record DatasetItemOptionResponse(
    String itemId,
    String itemKey,
    String label,
    String mediaType,
    String summary,
    int usedTaskCount,
    List<UsedTaskResponse> usedTasks) {

  public record UsedTaskResponse(
      String taskId,
      String title,
      String state) {}
}
