package com.labelhub.backend.annotation;

public record AssignmentAttachmentResponse(
    String fileId,
    String name,
    String mimeType,
    Long size,
    String checksum) {}
