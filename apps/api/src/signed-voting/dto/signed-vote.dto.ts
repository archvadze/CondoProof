import { IsString, Matches } from "class-validator";
import { CastVoteDto } from "../../proposals/dto/cast-vote.dto.js";

export class SignedVoteDto extends CastVoteDto {
  @IsString() @Matches(/^[A-Za-z0-9+/]{86}==$/)
  signatureBase64!: string;
}
