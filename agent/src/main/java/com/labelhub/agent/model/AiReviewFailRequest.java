package com.labelhub.agent.model;

public record AiReviewFailRequest(
    String runToken,
    String errorSummary) {}
