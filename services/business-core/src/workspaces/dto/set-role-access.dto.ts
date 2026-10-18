import { ApiProperty } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsInt, IsObject, IsString, Min } from "class-validator";

/** A role's access by module: one level per module and the advanced permissions given one by one. */
export class SetRoleAccessDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ example: { sales: "edit", inbox: "view" }, description: "Module id → none, view, edit or manage" })
  @IsObject()
  levels!: Record<string, string>;

  @ApiProperty({ type: [String], example: ["crm.parties.export"] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  extras!: string[];
}
