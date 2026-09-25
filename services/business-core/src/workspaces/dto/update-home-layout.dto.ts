import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, Min, ValidateNested } from "class-validator";

export class HomeWidgetDto {
  @IsIn(["attention", "planning", "projects", "sales", "tools", "attendance"])
  id!: "attention" | "planning" | "projects" | "sales" | "tools" | "attendance";

  @IsBoolean()
  visible!: boolean;

  @IsBoolean()
  wide!: boolean;
}

export class UpdateHomeLayoutDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique((widget: HomeWidgetDto) => widget?.id)
  @ValidateNested({ each: true })
  @Type(() => HomeWidgetDto)
  widgets!: HomeWidgetDto[];
}
