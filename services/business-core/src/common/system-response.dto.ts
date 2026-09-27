import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ServiceDescriptionResponseDto {
  @ApiProperty({ example: "business-core" }) service!: string;
  @ApiProperty({ example: "0.1.0" }) version!: string;
  @ApiProperty() responsibility!: string;
}

export class LivenessResponseDto {
  @ApiProperty({ example: "ok" }) status!: string;
  @ApiProperty({ example: "business-core" }) service!: string;
}

export class ReadinessChecksResponseDto {
  @ApiProperty({ example: "ok" }) postgres!: string;
  @ApiProperty({ example: "ok" }) redis!: string;
  @ApiProperty({ example: "ok" }) intelligenceApi!: string;
  @ApiProperty({ example: "ok" }) outboxWorker!: string;
  @ApiProperty({ example: "ok", description: "The Python delivery and timer worker: ok, stale (Ns), not-reporting or not-configured" }) worker!: string;
}

export class ReadinessResponseDto {
  @ApiProperty({ example: "ready" }) status!: string;
  @ApiProperty({ example: "business-core" }) service!: string;
  @ApiProperty({ example: "20260909-local" }) releaseId!: string;
  @ApiProperty({ type: ReadinessChecksResponseDto }) checks!: ReadinessChecksResponseDto;
  @ApiPropertyOptional({ type: [String], example: ["worker"], description: "Non-critical checks that need attention; the service stays ready" }) degraded?: string[];
  @ApiProperty({ format: "date-time" }) timestamp!: string;
}
