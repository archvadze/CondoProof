use anchor_lang::prelude::*;

declare_id!("3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF");

#[program]
pub mod condoproof {
    use super::*;

    pub fn initialize_building(
        _ctx: Context<InitializeBuilding>,
        building_hash: [u8; 32],
    ) -> Result<()> {
        let building = &mut _ctx.accounts.building;

        building.authority = _ctx.accounts.authority.key();
        building.building_hash = building_hash;
        building.bump = _ctx.bumps.building;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeBuilding<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + BuildingState::INIT_SPACE,
        seeds = [b"building"],
        bump
    )]
    pub building: Account<'info, BuildingState>,

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
