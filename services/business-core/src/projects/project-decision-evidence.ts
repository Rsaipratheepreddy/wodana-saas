import { BadRequestException } from '@nestjs/common';
import type { DecisionEvidenceFile, ProjectData } from './execution.types';

export function captureDecisionEvidence(data: ProjectData, recordId: string, value: unknown): DecisionEvidenceFile[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20 || new Set(value).size !== value.length)
    throw new BadRequestException('Select up to 20 distinct evidence files.');
  return value.map(id => {
    const file = data.files?.find(file => file.id === id && file.recordId === recordId);
    if (!file) throw new BadRequestException('Select evidence attached to this record.');
    return {id:file.id,name:file.name,mimeType:file.mimeType,bytes:file.bytes,sha256:file.sha256};
  });
}
