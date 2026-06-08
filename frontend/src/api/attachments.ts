import { apiRequest } from './client';

export interface AssignmentAttachment {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  checksum: string;
}

export const attachmentApi = {
  uploadAssignmentAttachment(
    assignmentId: string,
    fieldName: string,
    file: File,
  ): Promise<AssignmentAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest<AssignmentAttachment>(
      `/assignments/${encodeURIComponent(assignmentId)}/attachments?fieldName=${encodeURIComponent(fieldName)}`,
      {
        method: 'POST',
        body: formData,
      },
    );
  },

  downloadAssignmentAttachment(assignmentId: string, fileId: string): Promise<Blob> {
    return apiRequest<Blob>(
      `/assignments/${encodeURIComponent(assignmentId)}/attachments/${encodeURIComponent(fileId)}/download`,
      {
        responseType: 'blob',
      },
    );
  },
};
