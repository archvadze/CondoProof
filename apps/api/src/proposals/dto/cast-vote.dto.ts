import { IsIn, IsUUID } from "class-validator";
import type { Choice } from "../governance-policy.js";

export class CastVoteDto {
  @IsUUID()
  membershipId!: string;

  @IsIn(["APPROVE", "REJECT", "ABSTAIN"])
  choice!: Choice;
}
