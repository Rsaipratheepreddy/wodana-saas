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
  @ApiProperty({ example: "ok", description: "The Python delivery and timer worker: ok, stale (Ns), not-reporting or not-configured. In production anything but ok makes the service not ready (after a short start-up grace)." }) worker!: string;
  @ApiPropertyOptional({ example: "20260928120000-web", description: "The release whose worker wrote the last heartbeat" }) workerRelease?: string;
  @ApiPropertyOptional({ example: "live", description: "The worker's delivery mode: live, test or unconfigured" }) workerDelivery?: string;
}

export class ReadinessResponseDto {
  @ApiProperty({ example: "ready" }) status!: string;
  @ApiProperty({ example: "business-core" }) service!: string;
  @ApiProperty({ example: "20260909-local" }) releaseId!: string;
  @ApiProperty({ type: ReadinessChecksResponseDto }) checks!: ReadinessChecksResponseDto;
  @ApiPropertyOptional({ type: [String], example: ["worker"], description: "Checks that need attention while the service stays ready (outside production, or during the worker's start-up grace)" }) degraded?: string[];
  @ApiProperty({ format: "date-time" }) timestamp!: string;
}
