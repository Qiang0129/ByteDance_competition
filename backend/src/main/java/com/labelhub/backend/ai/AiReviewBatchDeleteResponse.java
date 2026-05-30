package com.labelhub.backend.ai;

import java.util.List;

public record AiReviewBatchDeleteResponse(
    int deletedCount,
    List<String> deletedJobIds) {}
