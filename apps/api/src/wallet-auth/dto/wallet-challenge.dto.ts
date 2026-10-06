import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class WalletChallengeDto {
  @IsString() @MinLength(32) @MaxLength(44) @Matches(/^[1-9A-HJ-NP-Za-km-z]+$/)
  walletAddress!: string;
}
