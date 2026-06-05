package com.labelhub.backend.dashboard;

public record DeadlineAlertResponse(
    String taskId,
    String title,
    long pending,
    String deadline,
    long hoursLeft,
    String riskLevel) {}
