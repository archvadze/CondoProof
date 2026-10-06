import { IsString, IsUUID, Matches } from "class-validator";

export class WalletLoginDto {
  @IsUUID()
  challengeId!: string;

  @IsString() @Matches(/^[A-Za-z0-9+/]{86}==$/)
  signatureBase64!: string;
}
