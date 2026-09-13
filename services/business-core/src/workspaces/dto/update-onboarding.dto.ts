import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsEnum, IsInt, IsOptional, Min } from "class-validator";

export enum WorkspaceOnboardingStep {
  WorkspaceProfile = "workspace_profile",
  Organization = "organization",
  Team = "team",
  Integrations = "integrations",
}

export const REQUIRED_ONBOARDING_STEPS = [
  WorkspaceOnboardingStep.WorkspaceProfile,
  WorkspaceOnboardingStep.Organization,
] as const;

export class UpdateOnboardingDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ enum: WorkspaceOnboardingStep })
  @IsEnum(WorkspaceOnboardingStep)
  currentStep!: WorkspaceOnboardingStep;

  @ApiPropertyOptional({
    enum: WorkspaceOnboardingStep,
    isArray: true,
    description: "Complete set of finished steps; completed steps cannot be removed",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(WorkspaceOnboardingStep, { each: true })
  completedSteps?: WorkspaceOnboardingStep[];
}

export class CompleteOnboardingDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}
