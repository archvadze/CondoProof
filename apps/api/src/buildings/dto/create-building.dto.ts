import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateBuildingDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  governanceThresholdBps?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  quorumBps?: number;
}
