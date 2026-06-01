package com.labelhub.backend.dashboard;

public record SubmissionTimelineMonthResponse(
    String month,
    long onTime,
    long late,
    long absent) {}
