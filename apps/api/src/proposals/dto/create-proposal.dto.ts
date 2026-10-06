import { Type } from "class-transformer";
import {
  IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";

export class ProposedServiceVersionDto {
  @IsString() @MinLength(1) @MaxLength(160) @Matches(/\S/)
  title!: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsInt() @Min(0) @Max(2147483647)
  monthlyAmountMinor!: number;

  @IsString() @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsIn(["MONTHLY", "WEEKLY", "YEARLY", "ONE_OFF"])
  billingPeriod!: "MONTHLY" | "WEEKLY" | "YEARLY" | "ONE_OFF";

  @IsDefined() @IsObject()
  configJson!: Record<string, unknown>;
}

export class CreateProposalDto {
  @IsUUID()
  serviceId!: string;

  @IsUUID()
  createdByMembershipId!: string;

  @IsString() @MinLength(1) @MaxLength(160) @Matches(/\S/)
  title!: string;

  @IsOptional() @IsString() @MaxLength(4000)
  description?: string;

  @IsDefined() @ValidateNested() @Type(() => ProposedServiceVersionDto)
  proposedVersion!: ProposedServiceVersionDto;
}
