package com.labelhub.backend.export;

public record ExportOverviewResponse(
    long totalJobs,
    long succeededJobs,
    long failedJobs,
    long monthlyExportedItems,
    long monthlyFileSizeBytes) {}
