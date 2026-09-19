import { BadRequestException, ConflictException } from "@nestjs/common";
import type { RecipePreviewDto } from "./catalog.dto";

export type RecipeAxis = "width" | "height" | "length" | "depth";

export type StoredSurveyDimension = {
  id: string;
  name: string;
  unit: string;
  measured: number | null;
  measuredMetres?: number | null;
};

export type StoredRecipeSurvey = {
  id: string;
  version: number;
  status: string;
  entryId: string | null;
  dimensions: StoredSurveyDimension[];
};

const unitMetres: Record<RecipePreviewDto["dimensionUnit"], number> = {
  ft: 0.3048,
  m: 1,
  mm: 0.001,
};

const round = (value: number) => Number(value.toPrecision(12));

export function applySurveyMeasurement(
  input: RecipePreviewDto,
  survey: StoredRecipeSurvey,
) {
  const source = input.survey;
  if (!source) return { input, source: null, changes: [] as string[] };
  if (survey.id !== source.measurementId || survey.entryId !== source.entryId)
    throw new BadRequestException(
      "Choose the verified survey attached to this scope item.",
    );
  if (survey.version !== source.measurementVersion)
    throw new ConflictException(
      "This survey changed. Reload its measurements before calculating again.",
    );
  if (survey.status !== "verified")
    throw new ConflictException(
      "Verify the site survey before using it in an assembly calculation.",
    );
  if (!source.bindings.length || new Set(source.bindings.map((row) => row.axis)).size !== source.bindings.length ||
    new Set(source.bindings.map((row) => row.dimensionId)).size !== source.bindings.length)
    throw new BadRequestException("Bind each assembly axis to one distinct survey dimension.");
  for (const adjustment of source.adjustments ?? [])
    if (!Number.isFinite(adjustment.value) || adjustment.value <= 0 || adjustment.reason.trim().length < 8)
      throw new BadRequestException("Every measurement adjustment needs a positive value and a clear reason.");

  const dimensions = new Map(survey.dimensions.map((row) => [row.id, row]));
  const adjustments = new Map(
    (source.adjustments ?? []).map((row) => [row.axis, row]),
  );
  const values: Partial<Record<RecipeAxis, number>> = {};
  const evidence: Array<{
    axis: RecipeAxis;
    dimensionId: string;
    name: string;
    surveyValue: number;
    surveyUnit: string;
    appliedValue: number;
    appliedUnit: RecipePreviewDto["dimensionUnit"];
    adjusted: boolean;
    adjustmentReason: string | null;
  }> = [];
  const changes: string[] = [];

  for (const binding of source.bindings) {
    const dimension = dimensions.get(binding.dimensionId);
    if (!dimension || dimension.measured == null)
      throw new BadRequestException(
        `The ${binding.axis} binding needs a measured survey dimension.`,
      );
    const metres = dimension.measuredMetres;
    if (metres == null || !Number.isFinite(metres) || metres <= 0)
      throw new BadRequestException(
        `The ${binding.axis} survey dimension has no valid normalized length.`,
      );
    if (input[binding.axis] != null)
      throw new BadRequestException(
        `Record a reasoned ${binding.axis} adjustment instead of replacing the survey value directly.`,
      );
    const surveyValue = round(metres / unitMetres[input.dimensionUnit]);
    const adjustment = adjustments.get(binding.axis);
    const appliedValue = adjustment?.value ?? surveyValue;
    values[binding.axis] = appliedValue;
    evidence.push({
      axis: binding.axis,
      dimensionId: dimension.id,
      name: dimension.name,
      surveyValue: dimension.measured,
      surveyUnit: dimension.unit,
      appliedValue,
      appliedUnit: input.dimensionUnit,
      adjusted: Boolean(adjustment),
      adjustmentReason: adjustment?.reason ?? null,
    });
    if (adjustment)
      changes.push(
        `${binding.axis[0].toUpperCase()}${binding.axis.slice(1)} adjusted from ${surveyValue} ${input.dimensionUnit} to ${appliedValue} ${input.dimensionUnit}: ${adjustment.reason}`,
      );
  }
  for (const adjustment of adjustments.values())
    if (!source.bindings.some((binding) => binding.axis === adjustment.axis))
      throw new BadRequestException(
        `Bind ${adjustment.axis} to a survey dimension before adjusting it.`,
      );

  return {
    input: { ...input, ...values },
    source: {
      caseId: source.caseId,
      entryId: source.entryId,
      measurementId: source.measurementId,
      measurementVersion: source.measurementVersion,
      status: survey.status,
      dimensions: evidence,
    },
    changes,
  };
}
