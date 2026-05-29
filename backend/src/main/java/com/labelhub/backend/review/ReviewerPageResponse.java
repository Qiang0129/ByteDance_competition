package com.labelhub.backend.review;

import java.util.List;

public record ReviewerPageResponse<T>(
    List<T> items,
    int page,
    int pageSize,
    long total) {}
