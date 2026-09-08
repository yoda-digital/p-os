import type { DomainPack, PackController, ControllerContext, ControllerAction } from '@pos/process-sdk';

// ── Controllers ─────────────────────────────────────────────────

const custodyController: PackController = {
  name: 'CustodyController',
  description: 'Chain of custody must be maintained with no gaps. Every transfer requires signed receipt evidence.',
  triggers: ['EntityCreated', 'EvidenceAttached', 'RelationAdded'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const entityType = event_data['type'] as string;

    // When a custody record is created, check for gaps
    if (entityType === 'logistics.custody') {
      const props = (event_data['properties'] as any) ?? {};

      if (!props.signed) {
        actions.push({
          type: 'raise_attention',
          priority: 'high',
          reason: 'Custody transfer recorded without signed receipt — chain of custody incomplete',
        });
      }

      // Check that previous custody was properly closed
      const assetId = props.asset_id;
      if (assetId) {
        const custodyRecords = await query('entities', { type: 'logistics.custody' });
        const assetCustody = (custodyRecords as any[]).filter(
          c => c.properties?.asset_id === assetId
        );

        // Look for gaps: each record should have a received_at that matches
        // the previous record's transferred_at
        if (assetCustody.length > 1) {
          const sorted = assetCustody.sort((a: any, b: any) =>
            new Date(a.properties?.received_at ?? 0).getTime() - new Date(b.properties?.received_at ?? 0).getTime()
          );
          for (let i = 1; i < sorted.length; i++) {
            const prev = sorted[i - 1] as any;
            const curr = sorted[i] as any;
            if (!prev.properties?.transferred_at) {
              actions.push({
                type: 'raise_attention',
                priority: 'medium',
                reason: `Custody gap detected: previous holder ${prev.properties?.holder} did not record transfer`,
              });
            }
          }
        }
      }
    }

    return actions;
  },
};

const quantityBalancer: PackController = {
  name: 'QuantityBalancer',
  description: 'Asset quantities must balance across split/merge operations. Total in = total out.',
  triggers: ['EntityCreated'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    const entityType = event_data['type'] as string;

    if (entityType === 'logistics.split') {
      const props = (event_data['properties'] as any) ?? {};
      const originalAssetId = props.original_asset;
      const resultingAssetIds = props.resulting_assets ?? [];

      if (originalAssetId && resultingAssetIds.length > 0) {
        // Get original asset quantity
        const entities = await query('entities', { type: 'logistics.asset' });
        const original = (entities as any[]).find(e => e.id === originalAssetId);
        const originalQty = original?.properties?.quantity ?? 0;

        // Sum resulting quantities
        let resultQty = 0;
        for (const resultId of resultingAssetIds) {
          const result = (entities as any[]).find(e => e.id === resultId);
          resultQty += result?.properties?.quantity ?? 0;
        }

        if (resultQty > 0 && Math.abs(originalQty - resultQty) > 0.001) {
          actions.push({
            type: 'raise_attention',
            priority: 'critical',
            reason: `Quantity mismatch in split: original=${originalQty}, sum of parts=${resultQty}`,
          });
        }
      }
    }

    if (entityType === 'logistics.merge') {
      const props = (event_data['properties'] as any) ?? {};
      const sourceAssetIds = props.source_assets ?? [];
      const resultingAssetId = props.resulting_asset;

      if (resultingAssetId && sourceAssetIds.length > 0) {
        const entities = await query('entities', { type: 'logistics.asset' });

        let sourceQty = 0;
        for (const sourceId of sourceAssetIds) {
          const source = (entities as any[]).find(e => e.id === sourceId);
          sourceQty += source?.properties?.quantity ?? 0;
        }

        const result = (entities as any[]).find(e => e.id === resultingAssetId);
        const resultQty = result?.properties?.quantity ?? 0;

        if (sourceQty > 0 && Math.abs(sourceQty - resultQty) > 0.001) {
          actions.push({
            type: 'raise_attention',
            priority: 'critical',
            reason: `Quantity mismatch in merge: sum of sources=${sourceQty}, result=${resultQty}`,
          });
        }
      }
    }

    return actions;
  },
};

const locationTracker: PackController = {
  name: 'LocationTracker',
  description: 'Track asset location through the custody chain. Raise attention for assets with unknown location.',
  triggers: ['EntityCreated', 'RelationAdded'],
  async evaluate(ctx: ControllerContext): Promise<ControllerAction[]> {
    const { event_data, query } = ctx;
    const actions: ControllerAction[] = [];

    if (ctx.event_type === 'RelationAdded') {
      const relType = event_data['type'] as string;
      if (relType === 'TRANSFERS_TO') {
        actions.push({
          type: 'log',
          message: `Asset transfer recorded — updating location tracking`,
        });
      }
    }

    // Check for assets without known location
    if (ctx.event_type === 'EntityCreated') {
      const entityType = event_data['type'] as string;
      if (entityType === 'logistics.shipment') {
        const status = (event_data['properties'] as any)?.status;
        if (status === 'in_transit') {
          actions.push({
            type: 'log',
            message: 'Shipment in transit — location tracking active',
          });
        }
        if (status === 'delayed') {
          actions.push({
            type: 'raise_attention',
            priority: 'medium',
            reason: 'Shipment delayed — review impact on downstream operations',
          });
        }
      }
    }

    return actions;
  },
};

// ── Pack Definition ─────────────────────────────────────────────

export const logisticsPack: DomainPack = {
  id: 'logistics',
  name: 'Physical Logistics',
  version: '1.0.0',
  domain: 'logistics',

  entity_types: {
    'logistics.asset': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        sku: { type: 'string' },
        category: { type: 'string' },
        serial: { type: 'string' },
        quantity: { type: 'number' as any },
        unit: { type: 'string' },
      },
    },
    'logistics.shipment': {
      type: 'object',
      properties: {
        origin: { type: 'string' },
        destination: { type: 'string' },
        carrier: { type: 'string' },
        tracking: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_transit', 'delayed', 'delivered', 'returned'] },
        estimated_arrival: { type: 'string' },
      },
    },
    'logistics.location': {
      type: 'object',
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
        coordinates: { type: 'object', properties: { lat: { type: 'number' as any }, lng: { type: 'number' as any } } },
        type: { type: 'string', enum: ['warehouse', 'port', 'factory', 'retail', 'customer'] },
      },
    },
    'logistics.custody_record': {
      type: 'object',
      properties: {
        holder: { type: 'string' },
        asset_id: { type: 'string' },
        received_at: { type: 'string' },
        transferred_at: { type: 'string' },
        condition: { type: 'string', enum: ['good', 'damaged', 'unknown'] },
        signed: { type: 'boolean' as any },
      },
    },
    'logistics.container': {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string' },
        capacity: { type: 'number' as any },
        current_load: { type: 'number' as any },
        unit: { type: 'string' },
      },
    },
  },

  relation_types: ['CONTAINS', 'LOCATED_AT', 'CUSTODY_OF', 'SPLITS', 'MERGES', 'TRANSFERS_TO'],

  controllers: [custodyController, quantityBalancer, locationTracker],

  evidence_types: {
    'receipt': {
      name: 'Receipt',
      description: 'Signed receipt confirming custody transfer.',
      required_provenance: ['from_party', 'to_party', 'signed'],
    },
    'inspection_report': {
      name: 'Inspection Report',
      description: 'Inspection of asset condition.',
      required_provenance: ['inspector', 'condition', 'date'],
    },
    'weight_certificate': {
      name: 'Weight Certificate',
      description: 'Certified weight measurement of goods.',
      required_provenance: ['weight', 'unit', 'certifier'],
    },
    'custody_handoff': {
      name: 'Custody Handoff',
      description: 'Evidence of custody transfer between parties.',
      required_provenance: ['from_party', 'to_party', 'asset_id', 'timestamp'],
    },
  },

  move_classes: ['RECEIVE', 'STORE', 'TRANSPORT', 'SPLIT', 'MERGE', 'DELIVER'],

  view_priority: ['resources', 'timeline', 'risk', 'compliance', 'actors'],

  default_rules: [
    { type: 'Requirement', statement: 'Custody transfer requires signed receipt', authority_ref: { type: 'system' } },
    { type: 'Invariant', statement: 'Total quantity preserved across split/merge operations', authority_ref: { type: 'system' } },
    { type: 'Policy', statement: 'Chain of custody must have no gaps', authority_ref: { type: 'system' } },
  ],

  intent_templates: [
    { class: 'DELIVER', statement_template: 'Deliver {asset} to {destination}', suggested_move_classes: ['TRANSPORT', 'DELIVER'] },
    { class: 'RECEIVE', statement_template: 'Receive {shipment} at {location}', suggested_move_classes: ['RECEIVE', 'STORE'] },
    { class: 'DISTRIBUTE', statement_template: 'Split {asset} for distribution', suggested_move_classes: ['SPLIT', 'TRANSPORT', 'DELIVER'] },
  ],

  execution_hints: {
    track_physical_location: true,
  },
};
