package com.labelhub.backend.ai;

public record AiTaskVolumeResponse(
    String taskId,
    String taskTitle,
    long total,
    long pass,
    long needHuman,
    long reject) {}
