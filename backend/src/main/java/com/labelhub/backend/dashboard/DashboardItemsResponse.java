package com.labelhub.backend.dashboard;

import java.util.List;

public record DashboardItemsResponse<T>(List<T> items) {}
