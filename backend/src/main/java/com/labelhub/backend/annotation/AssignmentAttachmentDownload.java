package com.labelhub.backend.annotation;

import java.nio.file.Path;

public record AssignmentAttachmentDownload(
    Path path,
    String filename,
    String mimeType,
    Long size) {}
