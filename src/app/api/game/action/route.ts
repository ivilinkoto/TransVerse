import { z } from 'zod';
import { getDb } from '@/server/db/client';
import { acceptContract } from '@/server/game/deliveries';
import { buyDepot, buyTrailer, buyVehicle, coupleTrailer, expandDepot, installUpgrade, repairVehicle, sellTrailer, sellVehicle } from '@/server/game/fleet';
import { markNotificationsRead } from '@/server/game/notify';
import { assignDriver, fireDriver, hireDriver } from '@/server/game/staff';
import { handler } from '@/server/http';

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
  }
});
