import { IsUUID, Matches } from "class-validator";
export class ProjectAttendanceDto {
  @IsUUID() projectId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}
