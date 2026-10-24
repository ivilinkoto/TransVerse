import { z } from 'zod';
import { companyNameSchema } from '@/server/auth/accounts';
import { foundCompany } from '@/server/game/company';
import { buyoutRental, returnRental, startTestDrive } from '@/server/game/rentals';
import { acceptTender } from '@/server/game/tenders';
import { claimDaily } from '@/server/game/daily';
import { dismissHint, markReleaseSeen, setSeasonalTheme } from '@/server/game/releases';
import { HINT_IDS, type HintId } from '@/lib/game/hints';
import { claimHalloweenQuest } from '@/server/game/halloween';
import { claimChristmasQuest } from '@/server/game/christmas';
import { claimMartaQuest, giveMartenitsa, spotStork } from '@/server/game/marta';
import { playParking } from '@/server/game/parking';
import { joinCup } from '@/server/game/tournament';
import { bidForPlate, fitRarePlate } from '@/server/game/plates';
import { hireTrailer, offerTrailer, returnHiredTrailer, withdrawTrailer } from '@/server/game/trailer-hire';
import { donateToMuseum, scrapVehicle, repairWithPart } from '@/server/game/heritage';
import { setSpecialization } from '@/server/game/specialization';
import { postRecruitment, removeRecruitment } from '@/server/game/recruitment';
import { SPECIALIZATIONS, type Specialization } from '@/lib/game/specialization';
import { setDriverOfMonthPrize, setShowcase, staffBus } from '@/server/game/community';
import { claimEasterQuest, eggFight } from '@/server/game/easter';
import { buyAllianceListing, listForAlliance, withdrawAllianceListing } from '@/server/game/alliance-market';
import { predictBattle } from '@/server/game/predictions';
import { createAlliance, dissolveAlliance, setAllianceDiscord, enrolAcademy, inviteToAlliance, leaveAlliance, offerCompanyContract, postAllianceMessage, rateCompanyContract, respondAllianceInvite, respondCompanyContract } from '@/server/game/alliances';
import { CARGO_TYPES } from '@/lib/game/cargo';
import { blockUser, reportPlayer, reportSchema, unblockUser } from '@/server/game/moderation';
import { answerDriver } from '@/server/game/moods';
import { joinRally } from '@/server/game/rally';
import { buyGoods, clearStock, postFreight, rateHauler, shipGoods } from '@/server/game/trade';
import { buyPremiumPass, claimPassRewards } from '@/server/game/season-pass';
import { deleteChannelMessage, deleteConversation, messageBodySchema, postToChannel, sendDirectMessage, unsendDirectMessage } from '@/server/game/messages';
import { inviteToCompany, removeFriend, respondCompanyInvite, respondFriendRequest, sendFriendRequest } from '@/server/game/social';
import { buyListing, cancelListing, createListing } from '@/server/game/used-market';
import { createTicket, replySchema, replyToTicket, setTicketStatus, ticketSchema } from '@/server/game/support';
import { completeTutorialStep, setTutorialDismissed } from '@/server/game/tutorial';
import type { Database } from '@/server/db/client';
import { acceptContract } from '@/server/game/deliveries';
import { appealFine, buyInsurance, payFine } from '@/server/game/fines';
import { planDispatch, runDispatch, setAutoDispatch } from '@/server/game/dispatch';
import { toggleFavoriteLane } from '@/server/game/favorites';
import { bidAuction } from '@/server/game/auctions';
import { quietHoursSchema, setQuietHours } from '@/server/push';
import { buyDepot, buyTrailer, buyVehicle, coupleTrailer, expandDepot, installTrailerUpgrade, installUpgrade, moveToDepot, repairVehicle, sellTrailer, sellVehicle, serviceVehicle } from '@/server/game/fleet';
import { borrowOrgTrailer, buyOrgTrailer, returnOrgTrailer, sellOrgTrailer, upgradeOrgTrailer } from '@/server/game/company-trailers';
import { markNotificationsRead } from '@/server/game/notify';
import { assignDriver, fireDriver, hireDriver, trainDriver } from '@/server/game/staff';
import { TRAIT_IDS } from '@/lib/game/crew';
import { acceptClientContract, declineClientContract, sendClientLoad } from '@/server/game/clients';
import { hashIp } from '@/server/game/referrals';
import { payOffLease } from '@/server/game/leasing';
import { bonusSchema, payBonus } from '@/server/game/bonuses';
import { setCompanyLivery, setLivery } from '@/server/game/livery';
import { buyDelivered, cancelBuild, expandPlot, likePlot, moveBuilding, orderMaterials, placeBuilding, placeDecor, removeDecor, startConstruction, upgradeBuilding } from '@/server/game/plot';
import { BUILDING_TYPES, DECOR_KINDS, type BuildingType, type DecorKind } from '@/lib/game/plot';
import { borrowOrgVehicle, buyOrgVehicle, NOTE_MAX, returnOrgVehicle, sellOrgVehicle, setOrgVehicleNote } from '@/server/game/company-fleet';
import { pinCompanyMessage, toggleReaction } from '@/server/game/chat-extras';
import { setDiscordPrefs, unlinkDiscord } from '@/server/discord/link';
import { setCompanyDiscord } from '@/server/discord/company';
import { closePoll, createPoll, votePoll } from '@/server/game/polls';
import { pollInputSchema } from '@/lib/game/polls';
import { sendMoney, transferSchema } from '@/server/game/transfers';
import { callForHelp, helpOnRoad, paidRoadHelp } from '@/server/game/roadside';
import { challengeDuel, respondDuel, shareLoad } from '@/server/game/together';
import { enterLiveryContest, voteLivery } from '@/server/game/livery-contest';
import { announceConvoy } from '@/server/game/convoy';
import { chooseRecipe, orderRaw, sellProduct } from '@/server/game/factory';
import { closeBranch, openBranch, repayLoan, takeLoan } from '@/server/game/business';
import { cheer } from '@/server/game/feed';
import type { FeatureId } from '@/lib/game/features';
import { requireFeature } from '@/server/features';
import { chooseWeeklyGoal, claimWeeklyGoal } from '@/server/game/weekly-goal';
import { chooseMentor, endMentorship, setMentorOpen } from '@/server/game/mentor';
import { declineJob, offerJob, offerSchema, setForHire } from '@/server/game/hire';
import { startProject } from '@/server/game/projects';
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
const tile = z.coerce.number().int().min(0).max(40);
const buildingType = z.enum(BUILDING_TYPES as [BuildingType, ...BuildingType[]]);

/** Every player command goes through this single, validated, server-authoritative endpoint. */
/** Every player command (the web game and the Discord bot alike). */
export const Action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('acceptContract'), contractId: id, vehicleId: id, rush: z.boolean().default(false), overload: z.boolean().default(false), tons: z.number().positive().max(100).optional(), rail: z.string().regex(/^[a-z-]+:[fr]$/).optional(), insure: z.boolean().default(false), route: z.enum(['fast', 'cheap']).default('fast'), parking: z.enum(['secure', 'free']).default('free'), refuel: z.boolean().default(false) }),
  z.object({ type: z.literal('payFine'), fineId: id }),
  z.object({ type: z.literal('dispatchPlan') }),
  z.object({ type: z.literal('auctionBid'), auctionId: id, amountEur: z.coerce.number().positive().max(10_000_000) }),
  z.object({ type: z.literal('quietHours'), hours: quietHoursSchema }),
  z.object({ type: z.literal('dismissHint'), hint: z.enum(HINT_IDS as [HintId, ...HintId[]]) }),
  z.object({ type: z.literal('favoriteLane'), originCityId: cityId, destCityId: cityId }),
  z.object({ type: z.literal('dispatchRun'), plan: z.array(z.object({ vehicleId: id, contractId: id })).min(1).max(50) }),
  z.object({ type: z.literal('autoDispatch'), vehicleId: id, on: z.boolean() }),
  z.object({ type: z.literal('appealFine'), fineId: id }),
  z.object({ type: z.literal('buyInsurance'), vehicleId: id }),
  z.object({ type: z.literal('buyVehicle'), modelId: z.string().max(40), cityId }),
  z.object({ type: z.literal('leaseVehicle'), modelId: z.string().max(40), cityId }),
  z.object({ type: z.literal('payOffLease'), leaseId: id }),
  z.object({ type: z.literal('payBonus'), bonus: bonusSchema }),
  z.object({ type: z.literal('placeBuilding'), building: buildingType, x: tile, y: tile }),
  z.object({ type: z.literal('moveBuilding'), building: buildingType, x: tile, y: tile }),
  z.object({ type: z.literal('upgradeBuilding'), building: buildingType }),
  z.object({ type: z.literal('orderMaterials'), buildId: id }),
  z.object({ type: z.literal('buyMaterialsDelivered'), buildId: id }),
  z.object({ type: z.literal('startConstruction'), buildId: id }),
  z.object({ type: z.literal('cancelBuild'), buildId: id }),
  z.object({ type: z.literal('likePlot'), organizationId: id }),
  z.object({ type: z.literal('placeDecor'), kind: z.enum(DECOR_KINDS as [DecorKind, ...DecorKind[]]), x: tile, y: tile }),
  z.object({ type: z.literal('removeDecor'), decorId: id }),
  z.object({ type: z.literal('expandPlot') }),
  z.object({ type: z.literal('buyOrgVehicle'), modelId: z.string().max(40) }),
  z.object({ type: z.literal('sellOrgVehicle'), orgVehicleId: id }),
  z.object({ type: z.literal('borrowOrgVehicle'), orgVehicleId: id }),
  z.object({ type: z.literal('returnOrgVehicle'), vehicleId: id }),
  z.object({ type: z.literal('createPoll'), poll: pollInputSchema }),
  z.object({ type: z.literal('votePoll'), pollId: id, option: z.number().int().min(0).max(9) }),
  z.object({ type: z.literal('closePoll'), pollId: id }),
  z.object({ type: z.literal('reactChat'), tab: z.string().regex(/^(global|trade|company|dm:[0-9a-f-]{36})$/), messageId: z.coerce.number().int().positive(), emoji: z.string().max(8) }),
  z.object({ type: z.literal('discordUnlink') }),
  z.object({ type: z.literal('discordPrefs'), prefs: z.record(z.string().max(20), z.boolean()) }),
  z.object({ type: z.literal('companyDiscord'), on: z.boolean() }),
  z.object({ type: z.literal('pinChat'), messageId: z.coerce.number().int().positive().nullable() }),
  z.object({ type: z.literal('orgVehicleNote'), orgVehicleId: id, note: z.string().max(NOTE_MAX * 2) }),
  z.object({ type: z.literal('setLivery'), color: z.string().max(9).nullable() }),
  z.object({ type: z.literal('companyLivery'), on: z.boolean() }),
  z.object({ type: z.literal('serviceVehicle'), vehicleId: id }),
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
  z.object({ type: z.literal('sendChat'), body: chatBodySchema, replyTo: z.coerce.number().int().positive().nullish() }),
  z.object({ type: z.literal('deleteChat'), messageId: z.coerce.number().int().positive() }),
  z.object({ type: z.literal('clearChat') }),
  z.object({ type: z.literal('acceptTender'), tenderId: id }),
  z.object({ type: z.literal('claimDaily') }),
  z.object({ type: z.literal('seenRelease'), version: z.string().trim().max(20) }),
  z.object({ type: z.literal('seasonalTheme'), on: z.boolean() }),
  z.object({ type: z.literal('claimHalloweenQuest'), questId: z.string().max(30) }),
  z.object({ type: z.literal('claimChristmasQuest'), questId: z.string().max(30) }),
  z.object({ type: z.literal('claimMartaQuest'), questId: z.string().max(30) }),
  z.object({ type: z.literal('giveMartenitsa'), friendId: id }),
  z.object({ type: z.literal('spotStork') }),
  z.object({ type: z.literal('claimEasterQuest'), questId: z.string().max(30) }),
  z.object({ type: z.literal('eggFight'), friendId: id }),
  z.object({ type: z.literal('staffBus'), vehicleId: id }),
  z.object({ type: z.literal('testDrive'), modelId: z.string().max(60) }),
  z.object({ type: z.literal('joinCup') }),
  z.object({ type: z.literal('bidPlate'), coins: z.coerce.number().int().positive().max(1_000_000), weekKey: z.string().max(12).optional() }),
  z.object({ type: z.literal('fitRarePlate'), weekKey: z.string().max(12), vehicleId: id }),
  z.object({ type: z.literal('offerTrailer'), trailerId: id, pricePerDay: z.coerce.number().positive().max(100_000), maxDays: z.coerce.number().int().min(1).max(7) }),
  z.object({ type: z.literal('withdrawTrailer'), hireId: id }),
  z.object({ type: z.literal('hireTrailer'), hireId: id, days: z.coerce.number().int().min(1).max(7) }),
  z.object({ type: z.literal('returnHiredTrailer'), hireId: id }),
  z.object({ type: z.literal('scrapVehicle'), vehicleId: id }),
  z.object({ type: z.literal('repairWithPart'), vehicleId: id }),
  z.object({ type: z.literal('donateToMuseum'), vehicleId: id }),
  z.object({ type: z.literal('setSpecialization'), specialization: z.enum(Object.keys(SPECIALIZATIONS) as [Specialization, ...Specialization[]]).nullable() }),
  z.object({ type: z.literal('postRecruitment'), kind: z.enum(['company', 'driver']), text: z.string().max(400), minLevel: z.coerce.number().int().min(1).max(100).optional() }),
  z.object({ type: z.literal('removeRecruitment'), postId: id }),
  z.object({ type: z.literal('parking'), inputs: z.array(z.number().int().min(-1).max(1)).max(400) }),
  z.object({ type: z.literal('driverOfMonthPrize'), cents: z.coerce.number().int().min(0).max(5_000_00) }),
  z.object({ type: z.literal('setShowcase'), trucks: z.array(id).max(3), badges: z.array(z.string().max(40)).max(3) }),
  z.object({ type: z.literal('listForAlliance'), depotId: id, cargo: z.enum(CARGO_TYPES), tons: z.coerce.number().positive().max(500), pricePerTon: z.coerce.number().positive().max(100_000) }),
  z.object({ type: z.literal('buyAllianceListing'), listingId: id }),
  z.object({ type: z.literal('withdrawAllianceListing'), listingId: id }),
  z.object({ type: z.literal('createAlliance'), name: z.string().max(40) }),
  z.object({ type: z.literal('inviteToAlliance'), target: z.string().max(40) }),
  z.object({ type: z.literal('respondAllianceInvite'), inviteId: id, accept: z.boolean() }),
  z.object({ type: z.literal('leaveAlliance') }),
  z.object({ type: z.literal('dissolveAlliance') }),
  z.object({ type: z.literal('allianceDiscord'), on: z.boolean() }),
  z.object({ type: z.literal('allianceMessage'), body: z.string().max(600) }),
  z.object({ type: z.literal('offerCompanyContract'), target: z.string().max(40), sharePct: z.coerce.number().int().min(5).max(30) }),
  z.object({ type: z.literal('respondCompanyContract'), contractId: id, accept: z.boolean() }),
  z.object({ type: z.literal('rateCompanyContract'), contractId: id, stars: z.coerce.number().int().min(1).max(5) }),
  z.object({ type: z.literal('enrolAcademy'), mentorId: id }),
  z.object({ type: z.literal('predictBattle'), battleId: id, pickOrgId: id }),
  z.object({ type: z.literal('blockUser'), userId: id }),
  z.object({ type: z.literal('unblockUser'), userId: id }),
  z.object({ type: z.literal('report'), report: reportSchema }),
  z.object({ type: z.literal('clearStock'), depotId: id, cargo: z.enum(CARGO_TYPES) }),
  z.object({ type: z.literal('buyGoods'), depotId: id, cargo: z.enum(CARGO_TYPES), tons: z.coerce.number().positive().max(500) }),
  z.object({ type: z.literal('shipGoods'), depotId: id, cargo: z.enum(CARGO_TYPES), tons: z.coerce.number().positive().max(500), destCityId: cityId, vehicleId: id, mode: z.enum(['sell', 'store']) }),
  z.object({ type: z.literal('buySeasonPass') }),
  z.object({ type: z.literal('claimSeasonPass') }),
  z.object({ type: z.literal('friendRequest'), userId: id }),
  z.object({ type: z.literal('friendRespond'), friendshipId: id, accept: z.boolean() }),
  z.object({ type: z.literal('friendRemove'), userId: id }),
  z.object({ type: z.literal('companyInvite'), userId: id }),
  z.object({ type: z.literal('companyInviteRespond'), inviteId: id, accept: z.boolean() }),
  z.object({ type: z.literal('sendDirect'), userId: id, body: messageBodySchema, replyTo: z.coerce.number().int().positive().nullish() }),
  z.object({ type: z.literal('sendMoney'), transfer: transferSchema }),
  z.object({ type: z.literal('mentorOpen'), on: z.boolean() }),
  z.object({ type: z.literal('cheer'), entryId: z.string().uuid() }),
  z.object({ type: z.literal('chooseWeeklyGoal'), difficulty: z.enum(['easy', 'normal', 'hard']) }),
  z.object({ type: z.literal('claimWeeklyGoal'), week: z.string().regex(/^W\d{4}-\d{2}$/) }),
  z.object({ type: z.literal('helpOnRoad'), deliveryId: z.string().uuid() }),
  z.object({ type: z.literal('chooseMentor'), mentorId: z.string().uuid() }),
  z.object({ type: z.literal('endMentorship'), id: z.string().uuid() }),
  z.object({ type: z.literal('offerJob'), offer: offerSchema }),
  z.object({ type: z.literal('declineJob'), offerId: id }),
  z.object({ type: z.literal('forHire'), on: z.boolean() }),
  z.object({ type: z.literal('startProject'), templateId: z.string().max(40) }),
  z.object({ type: z.literal('unsendDirect'), messageId: z.coerce.number().int().positive() }),
  z.object({ type: z.literal('deleteConversation'), userId: id }),
  z.object({ type: z.literal('sendChannel'), channel: z.enum(['global', 'trade']), body: messageBodySchema, replyTo: z.coerce.number().int().positive().nullish() }),
  z.object({ type: z.literal('deleteChannel'), messageId: z.coerce.number().int().positive() }),
  z.object({ type: z.literal('listUsed'), kind: z.enum(['vehicle', 'trailer']), itemId: id, priceEur: z.coerce.number().int('Цената е в цели лева.').positive().max(10_000_000) }),
  z.object({ type: z.literal('cancelListing'), listingId: id }),
  z.object({ type: z.literal('buyListing'), listingId: id }),
  z.object({ type: z.literal('claimMission'), periodKey: z.string().max(20), missionId: z.string().max(40) }),
  z.object({ type: z.literal('shareLoad'), contractId: id }),
  z.object({ type: z.literal('challengeDuel'), userId: id }),
  z.object({ type: z.literal('respondDuel'), duelId: id, accept: z.boolean() }),
  z.object({ type: z.literal('enterLivery'), vehicleId: id }),
  z.object({ type: z.literal('voteLivery'), entryId: id }),
  z.object({ type: z.literal('roadsidePaid'), deliveryId: id }),
  z.object({ type: z.literal('callForHelp'), deliveryId: id }),
  z.object({ type: z.literal('announceConvoy') }),
  z.object({ type: z.literal('factoryRecipe'), recipe: z.string().max(30) }),
  z.object({ type: z.literal('factoryOrder'), batches: z.coerce.number().int().min(1).max(5) }),
  z.object({ type: z.literal('factorySell'), cityId: z.coerce.number().int().positive() }),
  z.object({ type: z.literal('postFreight'), depotId: id, cargo: z.enum(CARGO_TYPES), tons: z.coerce.number().positive().max(60), destCityId: cityId, mode: z.enum(['sell', 'store']), priceEur: z.coerce.number().int().positive().max(1_000_000) }),
  z.object({ type: z.literal('rateHauler'), contractId: id, stars: z.coerce.number().int().min(1).max(5) }),
  z.object({ type: z.literal('openBranch'), cityId }),
  z.object({ type: z.literal('closeBranch'), branchId: id }),
  z.object({ type: z.literal('takeLoan'), amountEur: z.coerce.number().int().min(1_000).max(1_000_000), weeks: z.coerce.number().int() }),
  z.object({ type: z.literal('repayLoan') }),
  z.object({ type: z.literal('joinRally') }),
  z.object({ type: z.literal('moveToDepot'), vehicleId: id, depotId: id }),
  z.object({ type: z.literal('trailerUpgrade'), trailerId: id, upgradeId: z.string().max(40) }),
  z.object({ type: z.literal('buyOrgTrailer'), modelId: z.string().max(40) }),
  z.object({ type: z.literal('sellOrgTrailer'), orgTrailerId: id }),
  z.object({ type: z.literal('upgradeOrgTrailer'), orgTrailerId: id, upgradeId: z.string().max(40) }),
  z.object({ type: z.literal('borrowOrgTrailer'), orgTrailerId: id }),
  z.object({ type: z.literal('returnOrgTrailer'), trailerId: id }),
  z.object({ type: z.literal('answerDriver'), driverId: id, accept: z.boolean() }),
]);

/** Actions of features that go live with a release (staff can use them earlier, to test). */
const ACTION_FEATURE: Partial<Record<string, FeatureId>> = {
  sendMoney: 'transfers',
  offerJob: 'hire',
  declineJob: 'hire',
  forHire: 'hire',
  startProject: 'projects',
  mentorOpen: 'mentor',
  chooseMentor: 'mentor',
  endMentorship: 'mentor',
  helpOnRoad: 'roadside',
  shareLoad: 'shared_loads',
  challengeDuel: 'duels',
  respondDuel: 'duels',
  enterLivery: 'livery_contest',
  voteLivery: 'livery_contest',
  roadsidePaid: 'roadside_paid',
  callForHelp: 'roadside_paid',
  announceConvoy: 'discord_bot',
  factoryRecipe: 'factories',
  factoryOrder: 'factories',
  factorySell: 'factories',
  postFreight: 'freight_exchange',
  rateHauler: 'freight_exchange',
  openBranch: 'branches',
  closeBranch: 'branches',
  takeLoan: 'loans',
  repayLoan: 'loans',
  answerDriver: 'driver_moods',
  joinRally: 'rally',
  claimMartaQuest: 'marta',
  giveMartenitsa: 'marta',
  spotStork: 'marta',
  claimEasterQuest: 'easter',
  eggFight: 'easter',
  staffBus: 'staff_bus',
  testDrive: 'test_drive',
  parking: 'parking_game',
  joinCup: 'spring_cup',
  bidPlate: 'plate_auction',
  fitRarePlate: 'plate_auction',
  offerTrailer: 'trailer_hire',
  withdrawTrailer: 'trailer_hire',
  hireTrailer: 'trailer_hire',
  returnHiredTrailer: 'trailer_hire',
  scrapVehicle: 'scrapyard',
  repairWithPart: 'scrapyard',
  donateToMuseum: 'museum',
  setSpecialization: 'specializations',
  postRecruitment: 'recruitment_board',
  removeRecruitment: 'recruitment_board',
  driverOfMonthPrize: 'driver_of_month',
  clearStock: 'warehouse_clearance',
  setShowcase: 'profile_showcase',
  listForAlliance: 'alliance_market',
  buyAllianceListing: 'alliance_market',
  withdrawAllianceListing: 'alliance_market',
  createAlliance: 'alliances',
  inviteToAlliance: 'alliances',
  respondAllianceInvite: 'alliances',
  leaveAlliance: 'alliances',
  dissolveAlliance: 'alliances',
  allianceDiscord: 'alliance_discord',
  allianceMessage: 'alliances',
  offerCompanyContract: 'company_contracts',
  respondCompanyContract: 'company_contracts',
  rateCompanyContract: 'company_contracts',
  enrolAcademy: 'academy',
  predictBattle: 'predictions',
  trailerUpgrade: 'trailer_upgrades',
  buyOrgTrailer: 'company_trailers',
  sellOrgTrailer: 'company_trailers',
  upgradeOrgTrailer: 'company_trailers',
  borrowOrgTrailer: 'company_trailers',
  cheer: 'feed',
  chooseWeeklyGoal: 'weekly_goal',
  claimWeeklyGoal: 'weekly_goal',
  leaseVehicle: 'leasing',
  payOffLease: 'leasing',
  payBonus: 'company_roles',
  placeBuilding: 'company_plot',
  moveBuilding: 'company_plot',
  upgradeBuilding: 'company_plot',
  orderMaterials: 'company_plot',
  buyMaterialsDelivered: 'company_plot',
  startConstruction: 'company_plot',
  cancelBuild: 'company_plot',
  likePlot: 'plot_guests',
  placeDecor: 'plot_decor',
  removeDecor: 'plot_decor',
  expandPlot: 'plot_expand',
  buyOrgVehicle: 'company_fleet',
  sellOrgVehicle: 'company_fleet',
  borrowOrgVehicle: 'company_fleet',
  returnOrgVehicle: 'company_fleet',
  createPoll: 'company_polls',
  votePoll: 'company_polls',
  closePoll: 'company_polls',
  reactChat: 'chat_reactions',
  pinChat: 'chat_pin',
  discordUnlink: 'discord_bot',
  discordPrefs: 'discord_bot',
  companyDiscord: 'discord_bot',
  orgVehicleNote: 'truck_notes',
  setLivery: 'livery',
  companyLivery: 'livery',
  serviceVehicle: 'maintenance',
};

export type GameAction = z.infer<typeof Action>;

/**
 * Runs one player command for `user`: the only way the game changes on a
 * player's request. The web game calls it from /api/game/action, the Discord
 * bot from its buttons and commands; `ip` is the request's address (hashed
 * for anti-abuse checks).
 */
export async function runAction(db: Database, user: { id: string; role: string; username: string }, input: GameAction, ip: () => Promise<string>) {
  const feature = ACTION_FEATURE[input.type];
  if (feature) requireFeature(feature, user.role);
  switch (input.type) {
    case 'acceptContract': {
      const d = await acceptContract(db, user.id, input.contractId, input.vehicleId, new Date(), { rush: input.rush, overload: input.overload, tons: input.tons, rail: input.rail, insure: input.insure, route: input.route, parking: input.parking, refuel: input.refuel });
      return { ok: true, deliveryId: d.id, etaAt: d.etaAt };
    }
    case 'favoriteLane':
      return { ok: true, favorite: await toggleFavoriteLane(db, user.id, input.originCityId, input.destCityId) };
    case 'dismissHint':
      await dismissHint(db, user.id, input.hint);
      return { ok: true };
    case 'quietHours':
      await setQuietHours(db, user.id, input.hours);
      return { ok: true };
    case 'auctionBid':
      return { ok: true, ...(await bidAuction(db, user.id, input.auctionId, Math.round(input.amountEur * 100))) };
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
    case 'leaseVehicle':
      return { ok: true, id: (await buyVehicle(db, user.id, input.modelId, input.cityId, { lease: true })).id };
    case 'payOffLease':
      return { ok: true, amountCents: await payOffLease(db, user.id, input.leaseId) };
    case 'placeBuilding':
      return { ok: true, id: (await placeBuilding(db, user.id, input.building, input.x, input.y)).id };
    case 'moveBuilding':
      await moveBuilding(db, user.id, input.building, input.x, input.y);
      return { ok: true };
    case 'upgradeBuilding':
      return { ok: true, id: (await upgradeBuilding(db, user.id, input.building)).id };
    case 'orderMaterials':
      return { ok: true, ...(await orderMaterials(db, user.id, input.buildId)) };
    case 'buyMaterialsDelivered':
      return { ok: true, ...(await buyDelivered(db, user.id, input.buildId)) };
    case 'startConstruction':
      return { ok: true, endsAt: await startConstruction(db, user.id, input.buildId) };
    case 'cancelBuild':
      await cancelBuild(db, user.id, input.buildId);
      return { ok: true };
    case 'placeDecor':
      return { ok: true, id: (await placeDecor(db, user.id, input.kind, input.x, input.y)).id };
    case 'removeDecor':
      await removeDecor(db, user.id, input.decorId);
      return { ok: true };
    case 'expandPlot':
      return { ok: true, ...(await expandPlot(db, user.id)) };
    case 'buyOrgVehicle':
      return { ok: true, id: (await buyOrgVehicle(db, user.id, input.modelId)).id };
    case 'sellOrgVehicle':
      return { ok: true, valueCents: await sellOrgVehicle(db, user.id, input.orgVehicleId) };
    case 'borrowOrgVehicle':
      return { ok: true, vehicleId: (await borrowOrgVehicle(db, user.id, input.orgVehicleId)).id };
    case 'returnOrgVehicle':
      await returnOrgVehicle(db, user.id, input.vehicleId);
      return { ok: true };
    case 'createPoll':
      return { ok: true, id: (await createPoll(db, user.id, input.poll)).id };
    case 'votePoll':
      await votePoll(db, user.id, input.pollId, input.option);
      return { ok: true };
    case 'reactChat':
      return { ok: true, ...(await toggleReaction(db, user.id, input.tab, input.messageId, input.emoji)) };
    case 'discordUnlink':
      await unlinkDiscord(db, user.id);
      return { ok: true };
    case 'discordPrefs':
      await setDiscordPrefs(db, user.id, input.prefs);
      return { ok: true };
    case 'companyDiscord':
      await setCompanyDiscord(db, user.id, input.on);
      return { ok: true };
    case 'pinChat':
      await pinCompanyMessage(db, user.id, input.messageId);
      return { ok: true };
    case 'orgVehicleNote':
      await setOrgVehicleNote(db, user.id, input.orgVehicleId, input.note);
      return { ok: true };
    case 'closePoll':
      await closePoll(db, user.id, input.pollId);
      return { ok: true };
    case 'likePlot':
      return { ok: true, ...(await likePlot(db, user.id, input.organizationId)) };
    case 'setLivery':
      await setLivery(db, user.id, input.color);
      return { ok: true };
    case 'companyLivery':
      await setCompanyLivery(db, user.id, input.on);
      return { ok: true };
    case 'serviceVehicle':
      return { ok: true, costCents: await serviceVehicle(db, user.id, input.vehicleId) };
    case 'payBonus':
      return { ok: true, ...(await payBonus(db, user.id, input.bonus, await hashIp(db, await ip()))) };
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
      return { ok: true, id: await sendChatMessage(db, user.id, input.body, input.replyTo) };
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
    case 'shareLoad':
      return { ok: true, id: (await shareLoad(db, user.id, input.contractId)).id };
    case 'challengeDuel':
      return { ok: true, id: (await challengeDuel(db, user.id, input.userId)).id };
    case 'respondDuel':
      return { ok: true, ...(await respondDuel(db, user.id, input.duelId, input.accept)) };
    case 'enterLivery':
      return { ok: true, id: (await enterLiveryContest(db, user.id, input.vehicleId)).id };
    case 'voteLivery':
      return { ok: true, ...(await voteLivery(db, user.id, input.entryId)) };
    case 'roadsidePaid':
      return { ok: true, ...(await paidRoadHelp(db, user.id, input.deliveryId)) };
    case 'callForHelp':
      return { ok: true, ...(await callForHelp(db, user.id, input.deliveryId)) };
    case 'factoryRecipe':
      await chooseRecipe(db, user.id, input.recipe);
      return { ok: true };
    case 'factoryOrder':
      return { ok: true, ...(await orderRaw(db, user.id, input.batches)) };
    case 'factorySell':
      return { ok: true, ...(await sellProduct(db, user.id, input.cityId)) };
    case 'postFreight':
      return { ok: true, id: await postFreight(db, user.id, { depotId: input.depotId, cargo: input.cargo, tons: input.tons, destCityId: input.destCityId, mode: input.mode, priceCents: input.priceEur * 100 }) };
    case 'moveToDepot':
      return { ok: true, ...(await moveToDepot(db, user.id, input.vehicleId, input.depotId)) };
    case 'trailerUpgrade':
      return { ok: true, costCents: await installTrailerUpgrade(db, user.id, input.trailerId, input.upgradeId) };
    case 'buyOrgTrailer':
      return { ok: true, id: (await buyOrgTrailer(db, user.id, input.modelId)).id };
    case 'sellOrgTrailer':
      return { ok: true, valueCents: await sellOrgTrailer(db, user.id, input.orgTrailerId) };
    case 'upgradeOrgTrailer':
      return { ok: true, costCents: await upgradeOrgTrailer(db, user.id, input.orgTrailerId, input.upgradeId) };
    case 'borrowOrgTrailer':
      return { ok: true, trailerId: (await borrowOrgTrailer(db, user.id, input.orgTrailerId)).id };
    case 'returnOrgTrailer':
      await returnOrgTrailer(db, user.id, input.trailerId);
      return { ok: true };
    case 'joinRally':
      return { ok: true, ...(await joinRally(db, user.id)) };
    case 'answerDriver':
      return { ok: true, ...(await answerDriver(db, user.id, input.driverId, input.accept)) };
    case 'rateHauler':
      await rateHauler(db, user.id, input.contractId, input.stars);
      return { ok: true };
    case 'openBranch':
      return { ok: true, id: (await openBranch(db, user.id, input.cityId)).id };
    case 'closeBranch':
      await closeBranch(db, user.id, input.branchId);
      return { ok: true };
    case 'takeLoan':
      return { ok: true, id: (await takeLoan(db, user.id, input.amountEur * 100, input.weeks)).id };
    case 'repayLoan':
      return { ok: true, ...(await repayLoan(db, user.id)) };
    case 'announceConvoy': {
      const c = await announceConvoy(db, user.id);
      return { ok: true, origin: c.origin, destination: c.destination, expiresAt: c.expiresAt };
    }
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
      return { ok: true, id: await sendDirectMessage(db, user.id, input.userId, input.body, new Date(), input.replyTo) };
    case 'offerJob':
      return { ok: true, ...(await offerJob(db, user.id, input.offer)) };
    case 'declineJob':
      await declineJob(db, user.id, input.offerId);
      return { ok: true };
    case 'startProject':
      await startProject(db, user.id, input.templateId);
      return { ok: true };
    case 'forHire':
      await setForHire(db, user.id, input.on);
      return { ok: true };
    case 'helpOnRoad':
      return { ok: true, ...(await helpOnRoad(db, user.id, input.deliveryId)) };
    case 'chooseWeeklyGoal':
      await chooseWeeklyGoal(db, user.id, input.difficulty);
      return { ok: true };
    case 'claimWeeklyGoal':
      return { ok: true, ...(await claimWeeklyGoal(db, user.id, input.week)) };
    case 'cheer':
      return { ok: true, ...(await cheer(db, user.id, input.entryId)) };
    case 'mentorOpen':
      await setMentorOpen(db, user.id, input.on);
      return { ok: true };
    case 'chooseMentor':
      return { ok: true, ...(await chooseMentor(db, user.id, input.mentorId, await hashIp(db, await ip()))) };
    case 'endMentorship':
      await endMentorship(db, user.id, input.id);
      return { ok: true };
    case 'sendMoney':
      return { ok: true, ...(await sendMoney(db, user.id, input.transfer, await hashIp(db, await ip()))) };
    case 'unsendDirect':
      await unsendDirectMessage(db, user.id, input.messageId);
      return { ok: true };
    case 'deleteConversation':
      await deleteConversation(db, user.id, input.userId);
      return { ok: true };
    case 'sendChannel':
      return { ok: true, id: await postToChannel(db, user.id, input.channel, input.body, input.replyTo) };
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
    case 'createAlliance':
      return { ok: true, id: (await createAlliance(db, user.id, input.name)).id };
    case 'inviteToAlliance':
      await inviteToAlliance(db, user.id, input.target);
      return { ok: true };
    case 'respondAllianceInvite':
      await respondAllianceInvite(db, user.id, input.inviteId, input.accept);
      return { ok: true };
    case 'allianceDiscord':
      await setAllianceDiscord(db, user.id, input.on);
      return { ok: true };
    case 'dissolveAlliance':
      await dissolveAlliance(db, user.id);
      return { ok: true };
    case 'leaveAlliance':
      await leaveAlliance(db, user.id);
      return { ok: true };
    case 'allianceMessage':
      return { ok: true, id: await postAllianceMessage(db, user.id, input.body) };
    case 'offerCompanyContract':
      return { ok: true, id: (await offerCompanyContract(db, user.id, input.target, input.sharePct)).id };
    case 'respondCompanyContract':
      await respondCompanyContract(db, user.id, input.contractId, input.accept);
      return { ok: true };
    case 'rateCompanyContract':
      await rateCompanyContract(db, user.id, input.contractId, input.stars);
      return { ok: true };
    case 'predictBattle':
      await predictBattle(db, user.id, input.battleId, input.pickOrgId);
      return { ok: true };
    case 'enrolAcademy':
      await enrolAcademy(db, user.id, input.mentorId);
      return { ok: true };
    case 'clearStock':
      return { ok: true, ...(await clearStock(db, user.id, input.depotId, input.cargo)) };
    case 'driverOfMonthPrize':
      await setDriverOfMonthPrize(db, user.id, input.cents);
      return { ok: true };
    case 'parking':
      return { ok: true, ...(await playParking(db, user.id, input.inputs)) };
    case 'scrapVehicle':
      return { ok: true, ...(await scrapVehicle(db, user.id, input.vehicleId)) };
    case 'repairWithPart':
      return { ok: true, ...(await repairWithPart(db, user.id, input.vehicleId)) };
    case 'donateToMuseum':
      return { ok: true, ...(await donateToMuseum(db, user.id, input.vehicleId)) };
    case 'bidPlate':
      return { ok: true, ...(await bidForPlate(db, user.id, input.coins, new Date(), input.weekKey)) };
    case 'fitRarePlate':
      return { ok: true, ...(await fitRarePlate(db, user.id, input.weekKey, input.vehicleId)) };
    case 'offerTrailer':
      return { ok: true, offer: await offerTrailer(db, user.id, { trailerId: input.trailerId, pricePerDayCents: Math.round(input.pricePerDay * 100), maxDays: input.maxDays }) };
    case 'withdrawTrailer':
      return { ok: true, ...(await withdrawTrailer(db, user.id, input.hireId)) };
    case 'hireTrailer':
      return { ok: true, ...(await hireTrailer(db, user.id, input.hireId, input.days)) };
    case 'returnHiredTrailer':
      return { ok: true, ...(await returnHiredTrailer(db, user.id, input.hireId)) };
    case 'joinCup':
      return { ok: true, ...(await joinCup(db, user.id)) };
    case 'setSpecialization':
      return { ok: true, ...(await setSpecialization(db, user.id, input.specialization)) };
    case 'postRecruitment':
      return { ok: true, post: await postRecruitment(db, user.id, { kind: input.kind, text: input.text, minLevel: input.minLevel }) };
    case 'removeRecruitment':
      return { ok: true, ...(await removeRecruitment(db, user.id, input.postId)) };
    case 'testDrive':
      return { ok: true, ...(await startTestDrive(db, user.id, input.modelId)) };
    case 'claimEasterQuest':
      return { ok: true, ...(await claimEasterQuest(db, user.id, input.questId)) };
    case 'eggFight':
      return { ok: true, ...(await eggFight(db, user.id, input.friendId)) };
    case 'staffBus':
      return { ok: true, ...(await staffBus(db, user.id, input.vehicleId)) };
    case 'setShowcase':
      return { ok: true, ...(await setShowcase(db, user.id, { trucks: input.trucks, badges: input.badges })) };
    case 'listForAlliance':
      return { ok: true, listingId: (await listForAlliance(db, user.id, { depotId: input.depotId, cargo: input.cargo, tons: input.tons, pricePerTonCents: Math.round(input.pricePerTon * 100) })).id };
    case 'buyAllianceListing':
      return { ok: true, ...(await buyAllianceListing(db, user.id, input.listingId)) };
    case 'withdrawAllianceListing':
      await withdrawAllianceListing(db, user.id, input.listingId);
      return { ok: true };
    case 'claimMartaQuest':
      return { ok: true, ...(await claimMartaQuest(db, user.id, input.questId)) };
    case 'giveMartenitsa':
      await giveMartenitsa(db, user.id, input.friendId);
      return { ok: true };
    case 'spotStork':
      return { ok: true, ...(await spotStork(db, user.id)) };
    case 'claimChristmasQuest':
      return { ok: true, ...(await claimChristmasQuest(db, user.id, input.questId)) };
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
}
