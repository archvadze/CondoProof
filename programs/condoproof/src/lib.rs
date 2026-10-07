use anchor_lang::prelude::*;

declare_id!("3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF");

#[program]
pub mod condoproof {
    use super::*;

    pub fn initialize_building(
        ctx: Context<InitializeBuilding>,
        building_hash: [u8; 32],
    ) -> Result<()> {
        require_nonzero_hash(&building_hash)?;
        let building = &mut ctx.accounts.building;
        building.authority = ctx.accounts.authority.key();
        building.building_hash = building_hash;
        building.bump = ctx.bumps.building;
        Ok(())
    }

    /// Anchors a signed approval proof hash. Off-chain signature/policy verification
    /// is a separate check: the program authorizes the writer, not the electorate.
    pub fn record_commitment(
        ctx: Context<RecordCommitment>,
        proposal_hash: [u8; 32],
        commitment_hash: [u8; 32],
        service_version_hash: [u8; 32],
    ) -> Result<()> {
        require_nonzero_hash(&proposal_hash)?;
        require_nonzero_hash(&commitment_hash)?;
        require_nonzero_hash(&service_version_hash)?;
        let commitment = &mut ctx.accounts.commitment;
        commitment.schema_version = 1;
        commitment.building = ctx.accounts.building.key();
        commitment.proposal_hash = proposal_hash;
        commitment.commitment_hash = commitment_hash;
        commitment.service_version_hash = service_version_hash;
        commitment.recorded_slot = Clock::get()?.slot;
        commitment.bump = ctx.bumps.commitment;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(building_hash: [u8; 32])]
pub struct InitializeBuilding<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + BuildingState::INIT_SPACE,
        seeds = [b"building", authority.key().as_ref(), building_hash.as_ref()],
        bump
    )]
    pub building: Account<'info, BuildingState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proposal_hash: [u8; 32])]
pub struct RecordCommitment<'info> {
    #[account(
        seeds = [b"building", building.authority.as_ref(), building.building_hash.as_ref()],
        bump = building.bump,
        has_one = authority @ CondoProofError::UnauthorizedAuthority
    )]
    pub building: Account<'info, BuildingState>,
    #[account(
        init,
        payer = authority,
        space = 8 + CommitmentState::INIT_SPACE,
        seeds = [b"commitment", building.key().as_ref(), proposal_hash.as_ref()],
        bump
    )]
    pub commitment: Account<'info, CommitmentState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct BuildingState {
    pub authority: Pubkey,
    pub building_hash: [u8; 32],
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CommitmentState {
    pub schema_version: u8,
    pub building: Pubkey,
    pub proposal_hash: [u8; 32],
    pub commitment_hash: [u8; 32],
    pub service_version_hash: [u8; 32],
    pub recorded_slot: u64,
    pub bump: u8,
}

fn require_nonzero_hash(hash: &[u8; 32]) -> Result<()> {
    require!(
        hash.iter().any(|byte| *byte != 0),
        CondoProofError::ZeroHash
    );
    Ok(())
}

#[error_code]
pub enum CondoProofError {
    #[msg("Only the registered building authority may record commitments")]
    UnauthorizedAuthority,
    #[msg("Hash must not be all zero bytes")]
    ZeroHash,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn building_address(authority: &Pubkey, hash: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"building", authority.as_ref(), hash.as_ref()],
            &crate::ID,
        )
    }

    fn commitment_address(building: &Pubkey, proposal: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"commitment", building.as_ref(), proposal.as_ref()],
            &crate::ID,
        )
    }

    #[test]
    fn supports_multiple_buildings_and_isolates_authority_namespaces() {
        let authority = Pubkey::new_unique();
        let outsider = Pubkey::new_unique();
        let (first, _) = building_address(&authority, &[1; 32]);
        let (second, _) = building_address(&authority, &[2; 32]);
        let (foreign, _) = building_address(&outsider, &[1; 32]);
        assert_ne!(first, second);
        assert_ne!(first, foreign);
        assert_eq!(building_address(&authority, &[1; 32]).0, first);
    }

    #[test]
    fn commitment_identity_is_bound_to_building_and_proposal() {
        let first = Pubkey::new_unique();
        let second = Pubkey::new_unique();
        let (address, _) = commitment_address(&first, &[1; 32]);
        assert_ne!(address, commitment_address(&second, &[1; 32]).0);
        assert_ne!(address, commitment_address(&first, &[2; 32]).0);
        // Changing the payload does not create an alternative address for the same proposal.
        assert_eq!(address, commitment_address(&first, &[1; 32]).0);
    }

    #[test]
    fn rejects_empty_hash_but_accepts_leading_zero_digest() {
        assert!(require_nonzero_hash(&[0; 32]).is_err());
        let mut valid = [0; 32];
        valid[31] = 1;
        assert!(require_nonzero_hash(&valid).is_ok());
    }

    #[test]
    fn commitment_serialization_preserves_all_verification_fields() {
        let original = CommitmentState {
            schema_version: 1,
            building: Pubkey::new_unique(),
            proposal_hash: [1; 32],
            commitment_hash: [2; 32],
            service_version_hash: [3; 32],
            recorded_slot: 123456,
            bump: 254,
        };
        let mut bytes = Vec::new();
        original.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), 8 + CommitmentState::INIT_SPACE);
        let restored = CommitmentState::try_deserialize(&mut bytes.as_slice()).unwrap();
        assert_eq!(restored.schema_version, 1);
        assert_eq!(restored.building, original.building);
        assert_eq!(restored.proposal_hash, original.proposal_hash);
        assert_eq!(restored.commitment_hash, original.commitment_hash);
        assert_eq!(restored.service_version_hash, original.service_version_hash);
        assert_eq!(restored.recorded_slot, original.recorded_slot);
        assert_eq!(restored.bump, original.bump);
    }
}
