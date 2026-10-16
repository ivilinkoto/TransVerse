import { z } from 'zod';
import { companyNameSchema } from '@/server/auth/accounts';
import { foundCompany, rentVehicle, returnRental } from '@/server/game/company';
import { createTicket, replySchema, replyToTicket, setTicketStatus, ticketSchema } from '@/server/game/support';
import { completeTutorialStep, setTutorialDismissed } from '@/server/game/tutorial';
import { getDb } from '@/server/db/client';
import { acceptContract } from '@/server/game/deliveries';
import { buyDepot, buyTrailer, buyVehicle, coupleTrailer, expandDepot, installUpgrade, repairVehicle, sellTrailer, sellVehicle } from '@/server/game/fleet';
import { markNotificationsRead } from '@/server/game/notify';
import { assignDriver, fireDriver, hireDriver } from '@/server/game/staff';
import { handler } from '@/server/http';
import {
  buyCompanyUpgrade,
  createRank,
  decideApplication,
  deleteRank,
  joinCompany,
  kickMember,
  leaveCompany,
  profileSchema,
  rankInputSchema,
  removeAsset,
  setMemberRank,
  settingsSchema,
  updateProfile,
  updateRank,
  updateSettings,
  withdrawApplication,
  depositToTreasury,
  dissolveCompany,
  transferOwnership,
} from '@/server/game/membership';

const id = z.string().uuid('Невалиден идентификатор.');
const cityId = z.coerce.number().int().positive();

/** Every player command goes through this single, validated, server-authoritative endpoint. */
const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('acceptContract'), contractId: id, vehicleId: id }),
  z.object({ type: z.literal('buyVehicle'), modelId: z.string().max(40), cityId }),
  z.object({ type: z.literal('buyTrailer'), modelId: z.string().max(40), cityId }),
  z.object({ type: z.literal('sellVehicle'), vehicleId: id }),
  z.object({ type: z.literal('sellTrailer'), trailerId: id }),
  z.object({ type: z.literal('repairVehicle'), vehicleId: id }),
  z.object({ type: z.literal('installUpgrade'), vehicleId: id, upgradeId: z.string().max(40) }),
  z.object({ type: z.literal('coupleTrailer'), vehicleId: id, trailerId: id.nullable() }),
  z.object({ type: z.literal('hireDriver'), candidateId: id }),
  z.object({ type: z.literal('fireDriver'), driverId: id }),
  z.object({ type: z.literal('assignDriver'), driverId: id, vehicleId: id.nullable() }),
  z.object({ type: z.literal('buyDepot'), cityId }),
  z.object({ type: z.literal('expandDepot'), depotId: id }),
  z.object({ type: z.literal('markNotificationsRead') }),
  z.object({ type: z.literal('foundCompany'), name: companyNameSchema, hqCityId: cityId }),
  z.object({ type: z.literal('rentVehicle'), offerId: z.string().max(40), cityId }),
  z.object({ type: z.literal('returnRental'), vehicleId: id }),
  z.object({ type: z.literal('tutorialStep'), step: z.string().max(40) }),
  z.object({ type: z.literal('tutorialDismiss'), dismissed: z.boolean() }),
  z.object({ type: z.literal('createTicket'), ticket: ticketSchema }),
  z.object({ type: z.literal('replyTicket'), ticketId: id, body: replySchema }),
  z.object({ type: z.literal('closeTicket'), ticketId: id }),
  z.object({ type: z.literal('joinCompany'), companyId: id, message: z.string().max(500).default('') }),
  z.object({ type: z.literal('withdrawApplication'), applicationId: id }),
  z.object({ type: z.literal('decideApplication'), applicationId: id, accept: z.boolean() }),
  z.object({ type: z.literal('leaveCompany') }),
  z.object({ type: z.literal('kickMember'), userId: id }),
  z.object({ type: z.literal('setMemberRank'), userId: id, rankId: id }),
  z.object({ type: z.literal('createRank'), rank: rankInputSchema }),
  z.object({ type: z.literal('updateRank'), rankId: id, rank: rankInputSchema }),
  z.object({ type: z.literal('deleteRank'), rankId: id }),
  z.object({ type: z.literal('updateCompanyProfile'), profile: profileSchema }),
  z.object({ type: z.literal('updateCompanySettings'), settings: settingsSchema }),
  z.object({ type: z.literal('buyCompanyUpgrade'), upgradeId: z.string().max(40) }),
  z.object({ type: z.literal('removeCompanyAsset'), kind: z.enum(['logo', 'banner']) }),
  z.object({ type: z.literal('depositTreasury'), amountEur: z.coerce.number() }),
  z.object({ type: z.literal('transferOwnership'), userId: id, leave: z.boolean() }),
  z.object({ type: z.literal('dissolveCompany') }),
]);

export const POST = handler({ schema: Action, perMinute: 90 }, async ({ user, input }) => {
  const db = getDb();
  switch (input.type) {
    case 'acceptContract': {
      const d = await acceptContract(db, user.id, input.contractId, input.vehicleId);
      return { ok: true, deliveryId: d.id, etaAt: d.etaAt };
    }
    case 'buyVehicle':
      return { ok: true, id: (await buyVehicle(db, user.id, input.modelId, input.cityId)).id };
    case 'buyTrailer':
      return { ok: true, id: (await buyTrailer(db, user.id, input.modelId, input.cityId)).id };
    case 'sellVehicle':
      return { ok: true, valueCents: await sellVehicle(db, user.id, input.vehicleId) };
    case 'sellTrailer':
      return { ok: true, valueCents: await sellTrailer(db, user.id, input.trailerId) };
    case 'repairVehicle':
      return { ok: true, costCents: await repairVehicle(db, user.id, input.vehicleId) };
    case 'installUpgrade':
      await installUpgrade(db, user.id, input.vehicleId, input.upgradeId);
      return { ok: true };
    case 'coupleTrailer':
      await coupleTrailer(db, user.id, input.vehicleId, input.trailerId);
      return { ok: true };
    case 'hireDriver':
      return { ok: true, id: (await hireDriver(db, user.id, input.candidateId)).id };
    case 'fireDriver':
      await fireDriver(db, user.id, input.driverId);
      return { ok: true };
    case 'assignDriver':
      await assignDriver(db, user.id, input.driverId, input.vehicleId);
      return { ok: true };
    case 'buyDepot':
      return { ok: true, id: (await buyDepot(db, user.id, input.cityId)).id };
    case 'expandDepot':
      return { ok: true, costCents: await expandDepot(db, user.id, input.depotId) };
    case 'markNotificationsRead':
      await markNotificationsRead(db, user.id);
      return { ok: true };
    case 'foundCompany':
      await foundCompany(db, user.id, { name: input.name, hqCityId: input.hqCityId });
      return { ok: true };
    case 'rentVehicle':
      return { ok: true, id: (await rentVehicle(db, user.id, input.offerId, input.cityId)).id };
    case 'returnRental':
      await returnRental(db, user.id, input.vehicleId);
      return { ok: true };
    case 'tutorialStep':
      await completeTutorialStep(db, user.id, input.step);
      return { ok: true };
    case 'tutorialDismiss':
      await setTutorialDismissed(db, user.id, input.dismissed);
      return { ok: true };
    case 'createTicket':
      return { ok: true, id: (await createTicket(db, user, input.ticket)).id };
    case 'replyTicket':
      await replyToTicket(db, user, input.ticketId, input.body);
      return { ok: true };
    case 'closeTicket':
      await setTicketStatus(db, user, input.ticketId, 'closed');
      return { ok: true };
    case 'joinCompany':
      return { ok: true, result: await joinCompany(db, user.id, input.companyId, input.message) };
    case 'withdrawApplication':
      await withdrawApplication(db, user.id, input.applicationId);
      return { ok: true };
    case 'decideApplication':
      return { ok: true, result: await decideApplication(db, user.id, input.applicationId, input.accept) };
    case 'leaveCompany':
      await leaveCompany(db, user.id);
      return { ok: true };
    case 'kickMember':
      await kickMember(db, user.id, input.userId);
      return { ok: true };
    case 'setMemberRank':
      await setMemberRank(db, user.id, input.userId, input.rankId);
      return { ok: true };
    case 'createRank':
      return { ok: true, id: (await createRank(db, user.id, input.rank)).id };
    case 'updateRank':
      await updateRank(db, user.id, input.rankId, input.rank);
      return { ok: true };
    case 'deleteRank':
      await deleteRank(db, user.id, input.rankId);
      return { ok: true };
    case 'updateCompanyProfile':
      await updateProfile(db, user.id, input.profile);
      return { ok: true };
    case 'updateCompanySettings':
      await updateSettings(db, user.id, input.settings);
      return { ok: true };
    case 'buyCompanyUpgrade':
      return { ok: true, level: await buyCompanyUpgrade(db, user.id, input.upgradeId) };
    case 'removeCompanyAsset':
      await removeAsset(db, user.id, input.kind);
      return { ok: true };
    case 'depositTreasury':
      return { ok: true, amountCents: await depositToTreasury(db, user.id, input.amountEur) };
    case 'transferOwnership':
      await transferOwnership(db, user.id, input.userId, input.leave);
      return { ok: true };
    case 'dissolveCompany':
      return { ok: true, refundCents: await dissolveCompany(db, user.id) };
  }
});
