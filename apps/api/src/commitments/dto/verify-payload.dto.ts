import { IsDefined, IsObject } from "class-validator";

export class VerifyPayloadDto {
  @IsDefined() @IsObject()
  payload!: Record<string, unknown>;
}
