import { z } from 'zod';
import { companyNameSchema } from '@/server/auth/accounts';
import { foundCompany } from '@/server/game/company';
import { buyoutRental, returnRental } from '@/server/game/rentals';
import { acceptTender } from '@/server/game/tenders';
import { claimDaily } from '@/server/game/daily';
import { markReleaseSeen, setSeasonalTheme } from '@/server/game/releases';
import { claimHalloweenQuest } from '@/server/game/halloween';
import { CARGO_TYPES } from '@/lib/game/cargo';
import { blockUser, reportPlayer, reportSchema, unblockUser } from '@/server/game/moderation';
import { buyGoods, shipGoods } from '@/server/game/trade';
import { buyPremiumPass, claimPassRewards } from '@/server/game/season-pass';
import { deleteChannelMessage, deleteConversation, messageBodySchema, postToChannel, sendDirectMessage, unsendDirectMessage } from '@/server/game/messages';
import { inviteToCompany, removeFriend, respondCompanyInvite, respondFriendRequest, sendFriendRequest } from '@/server/game/social';
import { buyListing, cancelListing, createListing } from '@/server/game/used-market';
import { createTicket, replySchema, replyToTicket, setTicketStatus, ticketSchema } from '@/server/game/support';
import { completeTutorialStep, setTutorialDismissed } from '@/server/game/tutorial';
import { getDb } from '@/server/db/client';
import { acceptContract } from '@/server/game/deliveries';
import { appealFine, buyInsurance, payFine } from '@/server/game/fines';
import { planDispatch, runDispatch, setAutoDispatch } from '@/server/game/dispatch';
import { toggleFavoriteLane } from '@/server/game/favorites';
import { buyDepot, buyTrailer, buyVehicle, coupleTrailer, expandDepot, installUpgrade, repairVehicle, sellTrailer, sellVehicle } from '@/server/game/fleet';
import { markNotificationsRead } from '@/server/game/notify';
import { assignDriver, fireDriver, hireDriver, trainDriver } from '@/server/game/staff';
import { TRAIT_IDS } from '@/lib/game/crew';
import { acceptClientContract, declineClientContract, sendClientLoad } from '@/server/game/clients';
import { handler } from '@/server/http';
import { buyCompanyLicence, buyLicence } from '@/server/game/licences';
import { claimMission, rerollMission } from '@/server/game/missions';
import { reserveContract } from '@/server/game/contracts';
import { buyShopItem, shopPurchaseSchema } from '@/server/game/shop';
import { chatBodySchema, clearCompanyChat, deleteChatMessage, sendChatMessage } from '@/server/game/chat';
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
  z.object({ type: z.literal('acceptContract'), contractId: id, vehicleId: id, rush: z.boolean().default(false), overload: z.boolean().default(false) }),
  z.object({ type: z.literal('payFine'), fineId: id }),
  z.object({ type: z.literal('dispatchPlan') }),
  z.object({ type: z.literal('favoriteLane'), originCityId: cityId, destCityId: cityId }),
  z.object({ type: z.literal('dispatchRun'), plan: z.array(z.object({ vehicleId: id, contractId: id })).min(1).max(50) }),
  z.object({ type: z.literal('autoDispatch'), vehicleId: id, on: z.boolean() }),
  z.object({ type: z.literal('appealFine'), fineId: id }),
  z.object({ type: z.literal('buyInsurance'), vehicleId: id }),
  z.object({ type: z.literal('buyVehicle'), modelId: z.string().max(40), cityId }),
  z.object({ type: z.literal('buyTrailer'), modelId: z.string().max(40), cityId }),
  z.object({ type: z.literal('sellVehicle'), vehicleId: id }),
  z.object({ type: z.literal('sellTrailer'), trailerId: id }),
  z.object({ type: z.literal('repairVehicle'), vehicleId: id }),
  z.object({ type: z.literal('installUpgrade'), vehicleId: id, upgradeId: z.string().max(40) }),
  z.object({ type: z.literal('coupleTrailer'), vehicleId: id, trailerId: id.nullable() }),
  z.object({ type: z.literal('hireDriver'), candidateId: id }),
  z.object({ type: z.literal('fireDriver'), driverId: id }),
  z.object({ type: z.literal('assignDriver'), driverId: id, vehicleId: id.nullable(), seat: z.enum(['main', 'co']).default('main') }),
  z.object({ type: z.literal('trainDriver'), driverId: id, trait: z.enum(TRAIT_IDS) }),
  z.object({ type: z.literal('clientAccept'), clientContractId: id }),
  z.object({ type: z.literal('clientDecline'), clientContractId: id }),
  z.object({ type: z.literal('clientLoad'), clientContractId: id, vehicleId: id }),
  z.object({ type: z.literal('buyDepot'), cityId }),
  z.object({ type: z.literal('expandDepot'), depotId: id }),
  z.object({ type: z.literal('markNotificationsRead') }),
  z.object({ type: z.literal('foundCompany'), name: companyNameSchema, hqCityId: cityId }),
  z.object({ type: z.literal('returnRental'), vehicleId: id }),
  z.object({ type: z.literal('buyoutRental'), vehicleId: id }),
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
  z.object({ type: z.literal('buyLicence'), licence: z.string().max(30) }),
  z.object({ type: z.literal('buyCompanyLicence'), licenceId: z.string().max(20) }),
  z.object({ type: z.literal('rerollMission'), periodKey: z.string().max(20), missionId: z.string().max(40) }),
  z.object({ type: z.literal('reserveContract'), contractId: id }),
  z.object({ type: z.literal('shopBuy'), purchase: shopPurchaseSchema }),
  z.object({ type: z.literal('sendChat'), body: chatBodySchema }),
  z.object({ type: z.literal('deleteChat'), messageId: z.coerce.number().int().positive() }),
  z.object({ type: z.literal('clearChat') }),
  z.object({ type: z.literal('acceptTender'), tenderId: id }),
  z.object({ type: z.literal('claimDaily') }),
  z.object({ type: z.literal('seenRelease'), version: z.string().trim().max(20) }),
  z.object({ type: z.literal('seasonalTheme'), on: z.boolean() }),
  z.object({ type: z.literal('claimHalloweenQuest'), questId: z.string().max(30) }),
  z.object({ type: z.literal('blockUser'), userId: id }),
  z.object({ type: z.literal('unblockUser'), userId: id }),
  z.object({ type: z.literal('report'), report: reportSchema }),
  z.object({ type: z.literal('buyGoods'), depotId: id, cargo: z.enum(CARGO_TYPES), tons: z.coerce.number().positive().max(500) }),
  z.object({ type: z.literal('shipGoods'), depotId: id, cargo: z.enum(CARGO_TYPES), tons: z.coerce.number().positive().max(500), destCityId: cityId, vehicleId: id, mode: z.enum(['sell', 'store']) }),
  z.object({ type: z.literal('buySeasonPass') }),
  z.object({ type: z.literal('claimSeasonPass') }),
  z.object({ type: z.literal('friendRequest'), userId: id }),
  z.object({ type: z.literal('friendRespond'), friendshipId: id, accept: z.boolean() }),
  z.object({ type: z.literal('friendRemove'), userId: id }),
  z.object({ type: z.literal('companyInvite'), userId: id }),
  z.object({ type: z.literal('companyInviteRespond'), inviteId: id, accept: z.boolean() }),
  z.object({ type: z.literal('sendDirect'), userId: id, body: messageBodySchema }),
  z.object({ type: z.literal('unsendDirect'), messageId: z.coerce.number().int().positive() }),
  z.object({ type: z.literal('deleteConversation'), userId: id }),
  z.object({ type: z.literal('sendChannel'), channel: z.enum(['global', 'trade']), body: messageBodySchema }),
  z.object({ type: z.literal('deleteChannel'), messageId: z.coerce.number().int().positive() }),
  z.object({ type: z.literal('listUsed'), kind: z.enum(['vehicle', 'trailer']), itemId: id, priceEur: z.coerce.number().int('Цената е в цели евро.').positive().max(10_000_000) }),
  z.object({ type: z.literal('cancelListing'), listingId: id }),
  z.object({ type: z.literal('buyListing'), listingId: id }),
  z.object({ type: z.literal('claimMission'), periodKey: z.string().max(20), missionId: z.string().max(40) }),
]);

export const POST = handler({ schema: Action, perMinute: 90 }, async ({ user, input }) => {
  const db = getDb();
  switch (input.type) {
    case 'acceptContract': {
      const d = await acceptContract(db, user.id, input.contractId, input.vehicleId, new Date(), { rush: input.rush, overload: input.overload });
      return { ok: true, deliveryId: d.id, etaAt: d.etaAt };
    }
    case 'favoriteLane':
      return { ok: true, favorite: await toggleFavoriteLane(db, user.id, input.originCityId, input.destCityId) };
    case 'dispatchPlan':
      return { ok: true, plan: await planDispatch(db, user.id) };
    case 'dispatchRun':
      return { ok: true, ...(await runDispatch(db, user.id, input.plan)) };
    case 'autoDispatch':
      await setAutoDispatch(db, user.id, input.vehicleId, input.on);
      return { ok: true };
    case 'payFine':
      await payFine(db, user.id, input.fineId);
      return { ok: true };
    case 'appealFine':
      return { ok: true, ...(await appealFine(db, user.id, input.fineId)) };
    case 'buyInsurance':
      return { ok: true, ...(await buyInsurance(db, user.id, input.vehicleId)) };
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
      await assignDriver(db, user.id, input.driverId, input.vehicleId, input.seat);
      return { ok: true };
    case 'clientAccept':
      await acceptClientContract(db, user.id, input.clientContractId);
      return { ok: true };
    case 'clientDecline':
      await declineClientContract(db, user.id, input.clientContractId);
      return { ok: true };
    case 'clientLoad':
      return { ok: true, id: (await sendClientLoad(db, user.id, input.clientContractId, input.vehicleId)).id };
    case 'trainDriver':
      await trainDriver(db, user.id, input.driverId, input.trait);
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
    case 'buyoutRental':
      return { ok: true, ...(await buyoutRental(db, user.id, input.vehicleId)) };
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
    case 'rerollMission':
      return { ok: true, ...(await rerollMission(db, user.id, input.periodKey, input.missionId)) };
    case 'sendChat':
      return { ok: true, id: await sendChatMessage(db, user.id, input.body) };
    case 'deleteChat':
      await deleteChatMessage(db, user.id, input.messageId);
      return { ok: true };
    case 'listUsed':
      return { ok: true, listing: await createListing(db, user.id, { kind: input.kind, id: input.itemId, priceCents: input.priceEur * 100 }) };
    case 'cancelListing':
      await cancelListing(db, user.id, input.listingId);
      return { ok: true };
    case 'buyListing':
      await buyListing(db, user.id, input.listingId);
      return { ok: true };
    case 'friendRequest':
      return { ok: true, result: await sendFriendRequest(db, user.id, input.userId) };
    case 'friendRespond':
      return { ok: true, result: await respondFriendRequest(db, user.id, input.friendshipId, input.accept) };
    case 'friendRemove':
      await removeFriend(db, user.id, input.userId);
      return { ok: true };
    case 'companyInvite':
      return { ok: true, id: await inviteToCompany(db, user.id, input.userId) };
    case 'companyInviteRespond':
      return { ok: true, result: await respondCompanyInvite(db, user.id, input.inviteId, input.accept) };
    case 'sendDirect':
      return { ok: true, id: await sendDirectMessage(db, user.id, input.userId, input.body) };
    case 'unsendDirect':
      await unsendDirectMessage(db, user.id, input.messageId);
      return { ok: true };
    case 'deleteConversation':
      await deleteConversation(db, user.id, input.userId);
      return { ok: true };
    case 'sendChannel':
      return { ok: true, id: await postToChannel(db, user.id, input.channel, input.body) };
    case 'deleteChannel':
      await deleteChannelMessage(db, user.id, user.role, input.messageId);
      return { ok: true };
    case 'blockUser':
      await blockUser(db, user.id, input.userId);
      return { ok: true };
    case 'unblockUser':
      await unblockUser(db, user.id, input.userId);
      return { ok: true };
    case 'report':
      return { ok: true, id: await reportPlayer(db, user.id, input.report) };
    case 'buyGoods':
      return { ok: true, costCents: await buyGoods(db, user.id, input) };
    case 'shipGoods':
      return { ok: true, id: (await shipGoods(db, user.id, input)).id };
    case 'buySeasonPass':
      await buyPremiumPass(db, user.id);
      return { ok: true };
    case 'claimSeasonPass':
      return { ok: true, claimed: await claimPassRewards(db, user.id) };
    case 'seenRelease':
      await markReleaseSeen(db, user.id, input.version);
      return { ok: true };
    case 'claimHalloweenQuest':
      return { ok: true, ...(await claimHalloweenQuest(db, user.id, input.questId)) };
    case 'seasonalTheme':
      await setSeasonalTheme(db, user.id, input.on);
      return { ok: true };
    case 'claimDaily':
      return { ok: true, ...(await claimDaily(db, user.id)) };
    case 'acceptTender':
      return { ok: true, id: await acceptTender(db, user.id, input.tenderId) };
    case 'clearChat':
      return { ok: true, removed: await clearCompanyChat(db, user.id) };
    case 'shopBuy':
      return { ok: true, ...(await buyShopItem(db, user.id, input.purchase)) };
    case 'reserveContract':
      return { ok: true, until: await reserveContract(db, user.id, input.contractId) };
    case 'claimMission':
      return { ok: true, reward: await claimMission(db, user.id, input.periodKey, input.missionId) };
    case 'buyLicence':
      return { ok: true, licence: await buyLicence(db, user.id, input.licence) };
    case 'buyCompanyLicence':
      return { ok: true, licence: await buyCompanyLicence(db, user.id, input.licenceId) };
    case 'dissolveCompany':
      return { ok: true, refundCents: await dissolveCompany(db, user.id) };
  }
});
