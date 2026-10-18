import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, Min, ValidateNested } from "class-validator";

/** Home widgets a member can place; presentation only, never records or grants. */
export const HOME_WIDGET_IDS = ["attention", "projects", "trend", "money", "health", "planning", "activity", "storage", "sales", "tools", "attendance"] as const;
export const HOME_WIDGET_SIZES = ["small", "medium", "wide"] as const;

export class HomeWidgetDto {
  @IsIn(HOME_WIDGET_IDS)
  id!: typeof HOME_WIDGET_IDS[number];

  @IsBoolean()
  visible!: boolean;

  /** Layouts saved before sizes existed carry only `wide`. */
  @IsOptional()
  @IsBoolean()
  wide?: boolean;

  @IsOptional()
  @IsIn(HOME_WIDGET_SIZES)
  size?: typeof HOME_WIDGET_SIZES[number];
}

export class UpdateHomeLayoutDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsArray()
  @ArrayMaxSize(HOME_WIDGET_IDS.length)
  @ArrayUnique((widget: HomeWidgetDto) => widget?.id)
  @ValidateNested({ each: true })
  @Type(() => HomeWidgetDto)
  widgets!: HomeWidgetDto[];
}
